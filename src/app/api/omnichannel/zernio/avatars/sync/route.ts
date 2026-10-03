import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import { extractZernioMedia, isZernioPlaceholderName, normalizeMetaText } from '@/lib/omnichannel/webhook-normalizer'
import { getZernioParticipantProfile, listZernioConversationMessages } from '@/lib/zernio/server'

const PROVIDERS = ['zernio_whatsapp', 'zernio_facebook', 'zernio_instagram']
const MAX_CONVERSATIONS_PER_SYNC = 100
const CONCURRENCY = 5

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Falta la configuración del servidor.')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

type SyncConversation = {
  id: string
  contact_id: string
  external_session_id: string | null
  last_message_at: string | null
}

/**
 * "Sincronizar fotos y nombres" on a Zernio-connected channel. For the
 * most recent conversations of that connector it:
 *  1. refreshes the customer's avatar (original purpose of this action);
 *  2. replaces a placeholder contact name ("Cliente Facebook 123456") with
 *     the real `participantName` Zernio now knows — never touches a name
 *     a person already set;
 *  3. recovers INCOMING customer messages that are in Zernio but missing
 *     here (e.g. dropped by the inbound/auto-reply webhook race fixed in
 *     the webhook route). Matched on the platform message id, the same key
 *     the webhook stores, so nothing is duplicated. Outgoing messages are
 *     deliberately not recovered: ours are stored with Zernio's internal
 *     id, not the platform id this endpoint returns, so there is no safe
 *     key to dedupe them on.
 * Recovered messages are history only — no AI reply, automation or flow
 * is triggered for them.
 */
export async function POST(request: Request) {
  try {
    const { accountId } = await requireEntitlement('social_messaging', 'admin')
    const body = await request.json().catch(() => null) as { connectorId?: unknown } | null
    if (typeof body?.connectorId !== 'string' || !body.connectorId.trim()) {
      return NextResponse.json({ error: 'Selecciona una conexión válida.' }, { status: 400 })
    }

    const db = admin()
    const { data: connector, error: connectorError } = await db
      .from('omnichannel_connectors')
      .select('id, provider, zernio_account_id')
      .eq('id', body.connectorId)
      .eq('account_id', accountId)
      .in('provider', PROVIDERS)
      .maybeSingle()
    if (connectorError) throw connectorError
    if (!connector?.zernio_account_id) {
      return NextResponse.json({ error: 'La conexión no tiene una cuenta disponible.' }, { status: 409 })
    }
    const zernioAccountId = connector.zernio_account_id as string

    const { data, error } = await db
      .from('conversations')
      .select('id, contact_id, external_session_id, last_message_at')
      .eq('account_id', accountId)
      .eq('connector_id', connector.id)
      .not('external_session_id', 'is', null)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(MAX_CONVERSATIONS_PER_SYNC)
    if (error) throw error

    let updated = 0
    let unavailable = 0
    let renamed = 0
    let recoveredMessages = 0

    const syncOne = async (conversation: SyncConversation) => {
      const externalId = conversation.external_session_id
      if (!externalId) return
      const profile = await getZernioParticipantProfile(externalId, zernioAccountId).catch(() => null)

      if (profile?.picture) {
        const { error: updateError } = await db.from('omnichannel_contact_identities')
          .update({ avatar_url: profile.picture })
          .eq('connector_id', connector.id)
          .eq('contact_id', conversation.contact_id)
          .eq('account_id', accountId)
        if (updateError) throw updateError
        updated += 1
      } else {
        unavailable += 1
      }

      if (profile?.name && !isZernioPlaceholderName(profile.name)) {
        const { data: contact } = await db.from('contacts')
          .select('name').eq('id', conversation.contact_id).eq('account_id', accountId).maybeSingle()
        if (contact && isZernioPlaceholderName(contact.name as string | null)) {
          const { error: renameError } = await db.from('contacts')
            .update({ name: profile.name, updated_at: new Date().toISOString() })
            .eq('id', conversation.contact_id).eq('account_id', accountId)
          if (!renameError) {
            renamed += 1
            await db.from('omnichannel_contact_identities')
              .update({ display_name: profile.name })
              .eq('connector_id', connector.id).eq('contact_id', conversation.contact_id).eq('account_id', accountId)
          }
        }
      }

      const listed = await listZernioConversationMessages(externalId, zernioAccountId).catch(() => [])
      const incoming = listed.filter((m) => m.direction === 'incoming')
      if (incoming.length === 0) return

      const ids = incoming.map((m) => m.id)
      const { data: known, error: knownError } = await db.from('messages')
        .select('platform_message_id')
        .eq('conversation_id', conversation.id)
        .in('platform_message_id', ids)
      if (knownError) throw knownError
      const knownIds = new Set((known ?? []).map((row) => row.platform_message_id as string))
      const missing = incoming.filter((m) => !knownIds.has(m.id))
      if (missing.length === 0) return

      const rows = missing.map((m) => {
        const attachment = extractZernioMedia({ attachments: m.attachments })
        const contentType = attachment && attachment.kind !== 'text' ? attachment.kind : 'text'
        return {
          conversation_id: conversation.id,
          sender_type: 'customer',
          content_type: contentType,
          content_text: normalizeMetaText(m.text, attachment?.caption || attachment?.fileName),
          media_url: attachment?.url ?? null,
          message_id: `zernio:${connector.id}:${m.id}`,
          platform_message_id: m.id,
          status: 'delivered',
          created_at: m.createdAt,
        }
      })
      const { data: inserted, error: insertError } = await db.from('messages')
        .insert(rows)
        .select('id')
      if (insertError) throw insertError
      recoveredMessages += inserted?.length ?? 0

      const newest = missing.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
      if (!conversation.last_message_at || newest.createdAt > conversation.last_message_at) {
        await db.from('conversations')
          .update({ last_message_text: normalizeMetaText(newest.text), last_message_at: newest.createdAt, updated_at: new Date().toISOString() })
          .eq('id', conversation.id).eq('account_id', accountId)
      }
    }

    const conversations = (data ?? []) as SyncConversation[]
    for (let i = 0; i < conversations.length; i += CONCURRENCY) {
      await Promise.all(conversations.slice(i, i + CONCURRENCY).map((conversation) =>
        syncOne(conversation).catch((syncError) => {
          console.error('[zernio] sync failed for conversation', conversation.id, syncError)
        }),
      ))
    }

    return NextResponse.json({
      updated,
      unavailable,
      renamed,
      recovered_messages: recoveredMessages,
      scanned: conversations.length,
      capped: conversations.length === MAX_CONVERSATIONS_PER_SYNC,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
