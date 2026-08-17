import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/whatsapp/encryption'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { resolveAuditUserId } from '@/lib/api/v1/contacts'
import { isUniqueViolation } from '@/lib/contacts/dedupe'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

type MetaMessaging = {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: Array<{ type?: string }> }
}
type MetaCommentValue = {
  comment_id?: string; id?: string; parent_id?: string; post_id?: string; media_id?: string
  item?: string; message?: string; text?: string; from?: { id?: string; name?: string }
  media?: { id?: string }; post?: { id?: string }
}
type MetaChange = { field?: string; value?: MetaCommentValue }
type MetaEntry = { id?: string; time?: number; messaging?: MetaMessaging[]; changes?: MetaChange[] }
type MetaPayload = { object?: string; entry?: MetaEntry[] }
type Connector = {
  id: string; account_id: string; provider: 'facebook' | 'instagram'; display_name: string; external_channel_id: string
  meta_access_token: string | null; meta_app_secret: string | null; meta_verify_token: string | null; status: string
}

type MetaProfile = {
  name?: string
  avatarUrl?: string
}

type MetaCommentDetails = {
  text?: string
  name?: string
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase server configuration')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

function graphVersion() {
  const configured = process.env.META_GRAPH_API_VERSION?.trim()
  return /^v\d+\.\d+$/.test(configured ?? '') ? configured as string : 'v22.0'
}

function safeHttpsUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

/**
 * Messenger webhooks intentionally contain only the page-scoped sender ID.
 * Resolve the optional public profile server-side with the connector's token.
 * A profile lookup must never prevent the actual customer message from entering
 * the inbox: Meta can restrict it independently from webhook delivery.
 */
async function resolveMetaProfile(connector: Connector, externalUserId: string): Promise<MetaProfile | undefined> {
  if (!connector.meta_access_token || !externalUserId) return undefined
  try {
    const token = decrypt(connector.meta_access_token)
    const response = await fetch(
      `https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(externalUserId)}?fields=id,name,profile_pic`,
      {
        headers: { Authorization: `Bearer ${token}` },
        // Profile enrichment is useful, but delivery of the customer message is
        // more important. Keep the external lookup well below Meta's webhook
        // response window and continue with the safe fallback when unavailable.
        signal: AbortSignal.timeout(2_500),
      },
    )
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: { code?: number; message?: string } }
      console.info('[meta] profile lookup unavailable', {
        provider: connector.provider,
        status: response.status,
        graphCode: body.error?.code,
        detail: body.error?.message,
      })
      return undefined
    }
    const data = await response.json().catch(() => ({})) as { name?: unknown; profile_pic?: unknown }
    const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 120) : undefined
    const avatarUrl = safeHttpsUrl(data.profile_pic)
    return name || avatarUrl ? { name, avatarUrl } : undefined
  } catch (error) {
    console.info('[meta] profile lookup failed without blocking ingestion', {
      provider: connector.provider,
      error: error instanceof Error ? error.message : 'unknown',
    })
    return undefined
  }
}

/**
 * Facebook's feed event can contain a comment ID and author but omit the
 * body. The Page token may read the comment immediately afterwards. This is
 * enrichment only: a temporary Graph failure must never discard the event.
 */
async function resolveMetaCommentDetails(connector: Connector, commentId: string): Promise<MetaCommentDetails | undefined> {
  if (!connector.meta_access_token || !commentId) return undefined
  try {
    const token = decrypt(connector.meta_access_token)
    const response = await fetch(
      `https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(commentId)}?fields=message,from{id,name}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3_500) },
    )
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: { code?: number; message?: string } }
      console.info('[meta] comment text lookup unavailable', {
        provider: connector.provider,
        status: response.status,
        graphCode: body.error?.code,
        detail: body.error?.message,
      })
      return undefined
    }
    const data = await response.json().catch(() => ({})) as { message?: unknown; from?: { name?: unknown } }
    const text = typeof data.message === 'string' && data.message.trim() ? data.message.trim() : undefined
    const name = typeof data.from?.name === 'string' && data.from.name.trim() ? data.from.name.trim().slice(0, 120) : undefined
    return text || name ? { text, name } : undefined
  } catch (error) {
    console.info('[meta] comment text lookup failed without blocking ingestion', {
      provider: connector.provider,
      error: error instanceof Error ? error.message : 'unknown',
    })
    return undefined
  }
}

function eventType(provider: Connector['provider'], kind: 'message' | 'comment' = 'message') {
  if (kind === 'comment') return provider === 'facebook' ? 40011 : 40012
  return provider === 'facebook' ? 40001 : 40002
}
function time(value: unknown) {
  const raw = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(raw) || raw <= 0) return new Date().toISOString()
  // Meta's entry.time is seconds, while messaging.timestamp is milliseconds.
  const milliseconds = raw < 1_000_000_000_000 ? raw * 1000 : raw
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

async function claimReceipt(db: ReturnType<typeof admin>, connector: Connector, externalMessageId: string, kind: 'message' | 'comment' = 'message') {
  const type = eventType(connector.provider, kind)
  const { error } = await db.from('omnichannel_webhook_receipts').insert({
    account_id: connector.account_id, connector_id: connector.id, event_type: type, external_message_id: externalMessageId, outcome: 'processing',
  })
  if (!error) return true
  if (!isUniqueViolation(error)) throw error
  return false
}

async function resolveContact(db: ReturnType<typeof admin>, connector: Connector, externalUserId: string, auditUserId: string, profile?: MetaProfile) {
  const { data: mapped, error: mapError } = await db.from('omnichannel_contact_identities')
    .select('contact_id').eq('connector_id', connector.id).eq('external_user_id', externalUserId).maybeSingle()
  if (mapError) throw mapError
  if (mapped?.contact_id) {
    const contactId = mapped.contact_id as string
    const { data: contact, error: contactError } = await db.from('contacts')
      .select('name, avatar_url').eq('id', contactId).eq('account_id', connector.account_id).maybeSingle()
    if (contactError) throw contactError
    const fallbackName = `${connector.provider === 'facebook' ? 'Cliente Facebook' : 'Cliente Instagram'} ${externalUserId.slice(-6)}`
    const update: { name?: string; avatar_url?: string } = {}
    if (profile?.name && (!contact?.name || contact.name === fallbackName)) update.name = profile.name
    if (profile?.avatarUrl && !contact?.avatar_url) update.avatar_url = profile.avatarUrl
    if (Object.keys(update).length > 0) {
      const { error: updateError } = await db.from('contacts').update(update).eq('id', contactId).eq('account_id', connector.account_id)
      if (updateError) throw updateError
    }
    return contactId
  }

  const placeholderPhone = `meta:${connector.provider}:${externalUserId}`
  const { data: contactByPhone, error: phoneError } = await db.from('contacts')
    .select('id, name, avatar_url').eq('account_id', connector.account_id).eq('phone', placeholderPhone).maybeSingle()
  if (phoneError) throw phoneError
  let contactId = contactByPhone?.id as string | undefined
  if (!contactId) {
    const label = connector.provider === 'facebook' ? 'Cliente Facebook' : 'Cliente Instagram'
    const { data: contact, error: contactError } = await db.from('contacts').insert({
      account_id: connector.account_id,
      user_id: auditUserId,
      phone: placeholderPhone,
      name: profile?.name || `${label} ${externalUserId.slice(-6)}`,
      avatar_url: profile?.avatarUrl || null,
    }).select('id').single()
    if (contactError || !contact) throw contactError ?? new Error('No se pudo crear el contacto de Meta.')
    contactId = contact.id
  } else if (contactByPhone && (profile?.name || profile?.avatarUrl)) {
    const fallbackName = `${connector.provider === 'facebook' ? 'Cliente Facebook' : 'Cliente Instagram'} ${externalUserId.slice(-6)}`
    const update: { name?: string; avatar_url?: string } = {}
    if (profile.name && (!contactByPhone.name || contactByPhone.name === fallbackName)) update.name = profile.name
    if (profile.avatarUrl && !contactByPhone.avatar_url) update.avatar_url = profile.avatarUrl
    if (Object.keys(update).length > 0) {
      const { error: updateError } = await db.from('contacts').update(update).eq('id', contactId).eq('account_id', connector.account_id)
      if (updateError) throw updateError
    }
  }
  const { error: identityError } = await db.from('omnichannel_contact_identities').insert({
    account_id: connector.account_id, connector_id: connector.id, external_user_id: externalUserId, contact_id: contactId,
  })
  if (identityError && !isUniqueViolation(identityError)) throw identityError
  if (identityError) {
    const { data: concurrent } = await db.from('omnichannel_contact_identities').select('contact_id')
      .eq('connector_id', connector.id).eq('external_user_id', externalUserId).maybeSingle()
    if (concurrent?.contact_id) return concurrent.contact_id as string
  }
  return contactId
}

async function ingestMessage(db: ReturnType<typeof admin>, connector: Connector, entry: MetaEntry, event: MetaMessaging) {
  const senderId = event.sender?.id?.trim()
  const messageId = event.message?.mid?.trim()
  if (!senderId || !messageId || event.message?.is_echo || senderId === connector.external_channel_id) return { ignored: true }
  if (!await claimReceipt(db, connector, messageId)) return { duplicate: true }
  const auditUserId = await resolveAuditUserId(db, connector.account_id)
  const profile = await resolveMetaProfile(connector, senderId)
  const contactId = await resolveContact(db, connector, senderId, auditUserId, profile)
  const { data: rows, error: findError } = await db.from('conversations').select('id, unread_count')
    .eq('account_id', connector.account_id).eq('connector_id', connector.id).eq('external_session_id', senderId).limit(1)
  if (findError) throw findError
  let conversation = rows?.[0]
  let created = false
  if (!conversation) {
    const { data, error } = await db.from('conversations').insert({
      account_id: connector.account_id, user_id: auditUserId, contact_id: contactId, channel_type: connector.provider,
      connector_id: connector.id, external_session_id: senderId, channel_source_label: connector.display_name,
    }).select('id, unread_count').single()
    if (error || !data) throw error ?? new Error('No se pudo crear la conversación Meta.')
    conversation = data
    created = true
  }
  const attachment = event.message?.attachments?.[0]
  const contentText = event.message?.text?.trim() || (attachment?.type === 'image' ? '[Imagen enviada desde Meta]' : attachment ? `[Archivo enviado desde ${connector.provider === 'facebook' ? 'Facebook' : 'Instagram'}]` : '[Mensaje sin texto]')
  const createdAt = time(event.timestamp)
  const { error: messageError } = await db.from('messages').insert({
    conversation_id: conversation.id, sender_type: 'customer', content_type: attachment?.type === 'image' ? 'image' : 'text',
    content_text: contentText, message_id: `meta:${connector.id}:${messageId}`, status: 'delivered', created_at: createdAt,
  })
  if (messageError) throw messageError
  const now = new Date().toISOString()
  const { error: updateError } = await db.from('conversations').update({
    status: 'open', last_message_text: contentText, last_message_at: createdAt, unread_count: (conversation.unread_count ?? 0) + 1, updated_at: now,
  }).eq('id', conversation.id)
  if (updateError) throw updateError
  const { error: assignmentError } = await db.rpc('auto_assign_inbound_conversation', { p_account_id: connector.account_id, p_conversation_id: conversation.id })
  if (assignmentError) console.error('[meta] automatic assignment failed:', assignmentError.message)
  if (created) await dispatchWebhookEvent(db, connector.account_id, 'conversation.created', { conversation_id: conversation.id, contact_id: contactId, channel_type: connector.provider, connector_id: connector.id })
  await dispatchWebhookEvent(db, connector.account_id, 'message.received', { conversation_id: conversation.id, contact_id: contactId, message_id: `meta:${connector.id}:${messageId}`, channel_type: connector.provider, content_type: attachment?.type === 'image' ? 'image' : 'text', text: contentText })
  await db.from('omnichannel_webhook_receipts').update({ outcome: 'processed', detail: `Mensaje ${connector.provider} agregado.`, processed_at: now })
    .eq('connector_id', connector.id).eq('event_type', eventType(connector.provider)).eq('external_message_id', messageId)
  return { conversationId: conversation.id }
}

function valueText(value: MetaCommentValue | undefined, key: keyof MetaCommentValue) {
  const candidate = value?.[key]
  return typeof candidate === 'string' ? candidate.trim() : ''
}

async function findCommentConversation(db: ReturnType<typeof admin>, connector: Connector, parentId: string) {
  if (!parentId) return null
  const marker = `meta:comment:${connector.id}:${parentId}`
  const { data: parentMessage, error } = await db.from('messages').select('conversation_id')
    .eq('message_id', marker).limit(1).maybeSingle()
  if (error) throw error
  if (!parentMessage?.conversation_id) return null
  const { data: conversation, error: conversationError } = await db.from('conversations')
    .select('id, unread_count, social_comment_id').eq('id', parentMessage.conversation_id)
    .eq('account_id', connector.account_id).eq('connector_id', connector.id).maybeSingle()
  if (conversationError) throw conversationError
  return conversation
}

async function ingestComment(db: ReturnType<typeof admin>, connector: Connector, entry: MetaEntry, change: MetaChange) {
  const value = change.value
  const commentId = valueText(value, 'comment_id') || valueText(value, 'id')
  const senderId = value?.from?.id?.trim() || ''
  if (!commentId || !senderId || senderId === connector.external_channel_id) return { ignored: true }
  if (!await claimReceipt(db, connector, commentId, 'comment')) return { duplicate: true }
  const inlineText = valueText(value, 'message') || valueText(value, 'text')
  const details = inlineText ? undefined : await resolveMetaCommentDetails(connector, commentId)

  const auditUserId = await resolveAuditUserId(db, connector.account_id)
  const contactId = await resolveContact(db, connector, senderId, auditUserId, {
    name: value?.from?.name?.trim() || details?.name,
  })
  const parentId = valueText(value, 'parent_id')
  const postId = valueText(value, 'post_id') || valueText(value, 'media_id') || value?.media?.id?.trim() || value?.post?.id?.trim() || ''
  const parentConversation = await findCommentConversation(db, connector, parentId)
  const rootCommentId = parentConversation?.social_comment_id || commentId
  const sessionId = `comment:${rootCommentId}`
  const { data: rows, error: findError } = await db.from('conversations').select('id, unread_count, social_comment_id')
    .eq('account_id', connector.account_id).eq('connector_id', connector.id).eq('external_session_id', sessionId).limit(1)
  if (findError) throw findError
  let conversation = rows?.[0]
  let created = false
  if (!conversation) {
    const { data, error } = await db.from('conversations').insert({
      account_id: connector.account_id, user_id: auditUserId, contact_id: contactId, channel_type: connector.provider,
      connector_id: connector.id, external_session_id: sessionId,
      channel_source_label: `${connector.display_name} · Comentarios públicos`, social_comment_id: rootCommentId,
      social_parent_comment_id: parentId || null, social_post_id: postId || null,
    }).select('id, unread_count, social_comment_id').single()
    if (error || !data) throw error ?? new Error('No se pudo crear la conversación del comentario Meta.')
    conversation = data
    created = true
  }
  const contentText = inlineText || details?.text || '[Comentario sin texto]'
  const createdAt = time(entry.time)
  const { error: messageError } = await db.from('messages').insert({
    conversation_id: conversation.id, sender_type: 'customer', content_type: 'text', content_text: contentText,
    message_id: `meta:comment:${connector.id}:${commentId}`, status: 'delivered', created_at: createdAt,
  })
  if (messageError) throw messageError
  const now = new Date().toISOString()
  const { error: updateError } = await db.from('conversations').update({
    status: 'open', last_message_text: contentText, last_message_at: createdAt,
    unread_count: (conversation.unread_count ?? 0) + 1, updated_at: now,
  }).eq('id', conversation.id)
  if (updateError) throw updateError
  const { error: assignmentError } = await db.rpc('auto_assign_inbound_conversation', { p_account_id: connector.account_id, p_conversation_id: conversation.id })
  if (assignmentError) console.error('[meta] automatic assignment failed:', assignmentError.message)
  if (created) await dispatchWebhookEvent(db, connector.account_id, 'conversation.created', { conversation_id: conversation.id, contact_id: contactId, channel_type: connector.provider, connector_id: connector.id, public_comment: true })
  await dispatchWebhookEvent(db, connector.account_id, 'message.received', { conversation_id: conversation.id, contact_id: contactId, message_id: `meta:comment:${connector.id}:${commentId}`, channel_type: connector.provider, content_type: 'text', text: contentText, public_comment: true })
  await db.from('omnichannel_webhook_receipts').update({
    outcome: 'processed',
    detail: inlineText || details?.text
      ? `Comentario público de ${connector.provider} agregado.`
      : `Comentario público de ${connector.provider} agregado sin texto: Meta no entregó el cuerpo y el token no pudo leerlo.`,
    processed_at: now,
  })
    .eq('connector_id', connector.id).eq('event_type', eventType(connector.provider, 'comment')).eq('external_message_id', commentId)
  return { conversationId: conversation.id }
}

function isInboundComment(connector: Connector, change: MetaChange) {
  const field = change.field?.toLowerCase()
  const value = change.value
  if (!value) return false
  if (connector.provider === 'facebook') return field === 'feed' && (Boolean(value.comment_id) || (value.item === 'comment' && Boolean(value.id)))
  return field === 'comments' && Boolean(value.comment_id || value.id)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  if (url.searchParams.get('hub.mode') !== 'subscribe') return new NextResponse('Not found', { status: 404 })
  const verifyToken = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  if (!verifyToken || !challenge) return new NextResponse('Forbidden', { status: 403 })
  try {
    const { data, error } = await admin().from('omnichannel_connectors')
      .select('meta_verify_token').in('provider', ['facebook', 'instagram']).not('meta_verify_token', 'is', null)
    if (error) throw error
    const matched = (data ?? []).some((row) => {
      try { return decrypt(row.meta_verify_token as string) === verifyToken } catch { return false }
    })
    return matched
      ? new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      : new NextResponse('Forbidden', { status: 403 })
  } catch (error) {
    console.error('[meta] verification failed:', error)
    return new NextResponse('Unavailable', { status: 503 })
  }
}

export async function POST(request: Request) {
  const db = admin()
  try {
    const rawBody = await request.text()
    const payload = JSON.parse(rawBody) as MetaPayload
    if (payload.object !== 'page' && payload.object !== 'instagram') return NextResponse.json({ received: true, ignored: true })
    const ids = (payload.entry ?? []).map((entry) => entry.id?.trim()).filter((id): id is string => Boolean(id))
    const { data, error } = await db.from('omnichannel_connectors')
      .select('id, account_id, provider, display_name, external_channel_id, meta_access_token, meta_app_secret, meta_verify_token, status')
      .in('provider', ['facebook', 'instagram']).in('external_channel_id', ids)
    if (error) throw error
    const connectors = (data ?? []) as Connector[]
    const signature = request.headers.get('x-hub-signature-256')
    const signed = connectors.some((connector) => {
      try {
        if (!connector.meta_app_secret) return false
        return verifyMetaWebhookSignature(rawBody, signature, decrypt(connector.meta_app_secret))
      } catch { return false }
    })
    if (!signed) {
      // A successful Graph validation does not prove the App Secret used by Meta
      // matches the secret stored here. Persist an actionable state so the
      // administrator does not see a channel as merely “pending” forever.
      if (connectors.length > 0) {
        await db.from('omnichannel_connectors').update({
          status: 'error',
          last_error: 'Meta llegó al webhook, pero la firma no coincide. Revisa el App Secret de la misma app de Meta y guárdalo de nuevo en NexoOmni.',
          updated_at: new Date().toISOString(),
        }).in('id', connectors.map((connector) => connector.id))
      }
      return NextResponse.json({ error: 'Firma de webhook Meta inválida.' }, { status: 401 })
    }
    const byChannel = new Map(connectors.map((connector) => [connector.external_channel_id, connector]))
    let processed = 0
    for (const entry of payload.entry ?? []) {
      const connector = entry.id ? byChannel.get(entry.id) : undefined
      if (!connector || connector.status === 'paused') continue
      for (const event of entry.messaging ?? []) {
        try {
          const result = await ingestMessage(db, connector, entry, event)
          if ('conversationId' in result) processed += 1
        } catch (error) {
          console.error('[meta] could not ingest message:', error)
          const id = event.message?.mid
          if (id) await db.from('omnichannel_webhook_receipts').update({ outcome: 'failed', detail: 'No se pudo procesar el mensaje de Meta.', processed_at: new Date().toISOString() })
            .eq('connector_id', connector.id).eq('event_type', eventType(connector.provider)).eq('external_message_id', id)
        }
      }
      for (const change of entry.changes ?? []) {
        if (!isInboundComment(connector, change)) continue
        try {
          const result = await ingestComment(db, connector, entry, change)
          if ('conversationId' in result) processed += 1
        } catch (error) {
          console.error('[meta] could not ingest comment:', error)
          const commentId = valueText(change.value, 'comment_id') || valueText(change.value, 'id')
          if (commentId) await db.from('omnichannel_webhook_receipts').update({ outcome: 'failed', detail: 'No se pudo procesar el comentario de Meta.', processed_at: new Date().toISOString() })
            .eq('connector_id', connector.id).eq('event_type', eventType(connector.provider, 'comment')).eq('external_message_id', commentId)
        }
      }
      await db.from('omnichannel_connectors').update({ status: 'active', last_event_at: new Date().toISOString(), last_error: null }).eq('id', connector.id)
    }
    return NextResponse.json({ received: true, processed })
  } catch (error) {
    console.error('[meta] webhook processing failed:', error)
    return NextResponse.json({ error: 'No se pudo procesar el webhook Meta.' }, { status: 500 })
  }
}
