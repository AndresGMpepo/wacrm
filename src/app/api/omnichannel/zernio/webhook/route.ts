import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { resolveAuditUserId } from '@/lib/api/v1/contacts'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchInboundAutomations } from '@/lib/automations/inbound'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { extractZernioMedia, extractZernioReaction, normalizeMetaText, safeZernioContactName } from '@/lib/omnichannel/webhook-normalizer'
import { getZernioParticipantPicture, verifyZernioSignature, type ZernioChannel } from '@/lib/zernio/server'
import { isValidStatusTransition } from '@/lib/whatsapp/recipient-status-ladder'
import { flagBroadcastReplyIfAny } from '@/lib/whatsapp/broadcast-reply-flag'
import type { ChannelType } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

type Json = Record<string, unknown>
type Connector = {
  id: string
  account_id: string
  provider: `zernio_${ZernioChannel}`
  display_name: string
  zernio_account_id: string | null
  queue_id: string | null
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Falta la configuración del servidor.')
  return createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

function text(...values: unknown[]) {
  for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim()
  return ''
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

function record(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
}

function channelFrom(value: unknown): ZernioChannel | null {
  const normalized = text(value).toLowerCase()
  if (normalized.includes('instagram')) return 'instagram'
  if (normalized.includes('facebook') || normalized.includes('messenger')) return 'facebook'
  if (normalized.includes('whatsapp')) return 'whatsapp'
  return null
}

function entries(payload: Json) {
  if (Array.isArray(payload.events)) return payload.events.map(record)
  if (Array.isArray(payload.data)) return payload.data.map(record)
  return [payload]
}

async function resolveContact(
  db: ReturnType<typeof admin>,
  connector: Connector,
  externalUserId: string,
  auditUserId: string,
  name: string,
  email?: string,
  phone?: string,
  avatarUrl?: string,
): Promise<{ contactId: string; created: boolean }> {
  const { data: mapped, error: mapError } = await db
    .from('omnichannel_contact_identities')
    .select('contact_id, avatar_url')
    .eq('connector_id', connector.id)
    .eq('external_user_id', externalUserId)
    .maybeSingle()
  if (mapError) throw mapError
  if (mapped?.contact_id) {
    const contactId = mapped.contact_id as string
    if (avatarUrl && avatarUrl !== mapped.avatar_url) {
      const { error: updateError } = await db.from('omnichannel_contact_identities')
        .update({ avatar_url: avatarUrl })
        .eq('connector_id', connector.id)
        .eq('external_user_id', externalUserId)
      if (updateError) throw updateError
    }
    return { contactId, created: false }
  }

  const channel = connector.provider.replace('zernio_', '') as ZernioChannel
  const fallback = safeZernioContactName(channel, externalUserId)
  const placeholderPhone = `zernio:${connector.provider}:${externalUserId}`

  const phoneMatch = phone ? await findExistingContact(db, connector.account_id, phone) : null
  let emailMatch: { id: string; name: string | null; email: string | null; phone: string | null; avatar_url: string | null } | null = null
  if (!phoneMatch && email) {
    const normalizedEmail = email.trim().toLowerCase()
    const { data, error } = await db
      .from('contacts')
      .select('id, name, email, phone, avatar_url')
      .eq('account_id', connector.account_id)
      .eq('email_normalized', normalizedEmail)
      .limit(2)
    if (error) {
      console.error('[zernio] could not match contact by email:', error.message)
    } else if (data?.length === 1) {
      emailMatch = data[0]
    }
  }

  const existing = phoneMatch ?? emailMatch
  let contactId: string
  let contactCreated = false
  if (existing) {
    contactId = existing.id
    const update: Record<string, string> = {}
    const existingName = typeof existing.name === 'string' ? existing.name.trim() : ''
    if (name && (!existingName || existingName === fallback)) update.name = name
    if (email && !existing.email && email.trim()) update.email = email.trim()
    if (phone && existing.phone === placeholderPhone) update.phone = phone.trim()
    if (Object.keys(update).length) {
      const { error } = await db.from('contacts').update(update).eq('id', contactId).eq('account_id', connector.account_id)
      if (error && !isUniqueViolation(error)) console.error('[zernio] could not enrich existing contact:', error.message)
    }
  } else {
    const { data: created, error } = await db
      .from('contacts')
      .insert({ account_id: connector.account_id, user_id: auditUserId, phone: phone || placeholderPhone, email: email || null, name: name || fallback, avatar_url: avatarUrl || null })
      .select('id')
      .single()
    if (error || !created) throw error ?? new Error('No se pudo crear el contacto del canal conectado.')
    contactId = created.id
    contactCreated = true
  }

  const { error: identityError } = await db.from('omnichannel_contact_identities').insert({
    account_id: connector.account_id,
    connector_id: connector.id,
    external_user_id: externalUserId,
    contact_id: contactId,
    display_name: name || fallback,
    avatar_url: avatarUrl ?? null,
  })
  if (identityError && !isUniqueViolation(identityError)) throw identityError
  if (identityError) {
    const { data: concurrent } = await db
      .from('omnichannel_contact_identities')
      .select('contact_id')
      .eq('connector_id', connector.id)
      .eq('external_user_id', externalUserId)
      .maybeSingle()
    if (concurrent?.contact_id) return { contactId: concurrent.contact_id as string, created: false }
  }
  return { contactId, created: contactCreated }
}

async function registerReceipt(
  db: ReturnType<typeof admin>,
  connector: Connector,
  eventId: string,
  eventType: string,
  payload: Json,
) {
  const { error } = await db.from('zernio_webhook_receipts').insert({
    account_id: connector.account_id,
    connector_id: connector.id,
    external_message_id: eventId,
    event_type: eventType,
    payload,
  })
  if (!error) return true
  if (isUniqueViolation(error)) return false
  throw error
}

/**
 * Keeps our connector row in sync when Zernio reports a connect/disconnect
 * that didn't originate from our own Settings UI — e.g. a phone-side
 * WhatsApp Business app disconnect, or the user managing the connection
 * directly in Zernio's dashboard. Without this, NexoOmni can keep showing
 * a connector as usable long after Zernio (and Meta) have dropped it.
 * https://docs.zernio.com/webhooks/accounts
 */
async function handleAccountLifecycleEvent(
  db: ReturnType<typeof admin>,
  eventType: 'account.connected' | 'account.disconnected',
  account: Json,
) {
  const zernioAccountId = text(account.accountId, account.id, account._id)
  const channel = channelFrom(account.platform ?? account.channel ?? account.type)
  if (!zernioAccountId || !channel) return
  const now = new Date().toISOString()
  try {
    if (eventType === 'account.connected') {
      await db.from('omnichannel_connectors')
        .update({ status: 'configured', last_error: null, updated_at: now })
        .eq('provider', `zernio_${channel}`)
        .eq('zernio_account_id', zernioAccountId)
      return
    }
    const reason = text(account.reason, account.disconnectionType) || 'Desconectado desde Zernio/Meta.'
    await db.from('omnichannel_connectors')
      .update({ status: 'error', last_error: reason, updated_at: now })
      .eq('provider', `zernio_${channel}`)
      .eq('zernio_account_id', zernioAccountId)
  } catch (error) {
    console.error('[zernio] account lifecycle sync failed:', error)
  }
}

/**
 * Mirrors an OUTBOUND WhatsApp delivery-status webhook onto
 * broadcast_recipients — the same mirror the native (direct Meta)
 * webhook does, so a broadcast sent through a Zernio-connected number
 * gets the same delivered/read/failed stats. Zernio doesn't emit these
 * for arbitrary messages we didn't record; only broadcast sends set
 * `whatsapp_message_id`, so the lookup below naturally scopes itself.
 * https://docs.zernio.com/webhooks/inbox
 */
async function handleOutboundStatusEvent(
  db: ReturnType<typeof admin>,
  eventType: 'message.delivered' | 'message.read' | 'message.failed',
  message: Json,
  errorInfo: Json,
) {
  // Try every id shape Zernio might use for this message — the one we
  // stored as `whatsapp_message_id` (Zernio's own message id, returned
  // by Create conversation) may not be the first field this payload
  // happens to carry, so match against all of them instead of just
  // the first non-empty candidate.
  const candidateIds = [message.id, message.platformMessageId, message.platform_message_id, message._id]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
  if (candidateIds.length === 0) {
    console.warn(`[zernio] ${eventType} webhook carried no usable message id — payload:`, JSON.stringify(message).slice(0, 500))
    return
  }
  const status = eventType === 'message.delivered' ? 'delivered' : eventType === 'message.read' ? 'read' : 'failed'
  const now = new Date().toISOString()

  const { data: recipients, error: fetchError } = await db
    .from('broadcast_recipients')
    .select('id, status')
    .in('whatsapp_message_id', candidateIds)
    .limit(1)
  if (fetchError) {
    console.error('[zernio] could not look up broadcast recipient for status update:', fetchError.message)
    return
  }
  const recipient = recipients?.[0]
  if (!recipient) {
    console.warn(`[zernio] ${eventType} webhook matched no broadcast recipient for ids:`, candidateIds)
    return
  }
  if (!isValidStatusTransition(recipient.status, status)) {
    console.warn(`[zernio] ${eventType} webhook ignored — invalid transition ${recipient.status} -> ${status} for recipient ${recipient.id}`)
    return
  }

  const update: Record<string, unknown> = { status }
  if (status === 'delivered') update.delivered_at = now
  if (status === 'read') update.read_at = now
  if (status === 'failed') update.error_message = text(errorInfo.message, errorInfo.title) || 'Envío fallido reportado por Zernio.'

  const { error: updateError } = await db.from('broadcast_recipients').update(update).eq('id', recipient.id)
  if (updateError) console.error('[zernio] could not update broadcast recipient status:', updateError.message)
}

export async function POST(request: Request) {
  const raw = await request.text()
  const signature = request.headers.get('x-zernio-signature') ?? request.headers.get('x-late-signature')
  if (!verifyZernioSignature(raw, signature)) {
    return NextResponse.json({ error: 'Firma de webhook inválida.' }, { status: 401 })
  }

  let payload: Json
  try {
    payload = JSON.parse(raw) as Json
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }

  const db = admin()
  try {
    for (const event of entries(payload)) {
      const eventType = text(event.event, payload.event)

      if (eventType === 'account.connected' || eventType === 'account.disconnected') {
        await handleAccountLifecycleEvent(db, eventType, record(event.account))
        continue
      }
      if (eventType === 'message.delivered' || eventType === 'message.read' || eventType === 'message.failed') {
        await handleOutboundStatusEvent(db, eventType, record(event.message), record(event.error))
        continue
      }
      if (eventType !== 'message.received' && eventType !== 'comment.received' && eventType !== 'reaction.received') continue

      const message = record(event.message)
      const comment = record(event.comment)
      const reactionEvent = record(event.reaction)
      const incoming = eventType === 'comment.received' ? comment : message
      const conversation = record(event.conversation ?? incoming.conversation)
      const account = record(event.account ?? incoming.account)
      const post = record(event.post)
      // `conversation.participantId`/`participantName` (documented shape:
      // https://docs.zernio.com/messages/get-inbox-conversation) is the
      // primary contact identity for DM platforms — no nested
      // contact/customer/participant object exists there. Kept as a
      // fallback below in case an older/nested shape is ever delivered.
      const participantSource = conversation.contact ?? conversation.customer ?? conversation.participant
      const participant = record(participantSource)
      const sender = record(incoming.sender ?? event.sender ?? participantSource ?? comment.author)
      const externalUserId = text(conversation.participantId, incoming.senderId, sender.id, sender._id, sender.userId, participant.id, participant._id, comment.author_id, comment.authorId, conversation.customerId, conversation.contactId, event.senderId)
      const externalMessageId = text(incoming.platformMessageId, incoming.id, incoming._id, event.messageId, event.id)
      const externalEventId = text(event.id, request.headers.get('x-zernio-event-id'), externalMessageId)
      const externalConversationId = text(
        conversation.id,
        conversation._id,
        incoming.conversationId,
        event.conversationId,
        eventType === 'comment.received' && externalUserId ? `comment:${text(post.id, post._id, event.postId)}:${externalUserId}` : '',
      )
      const channel = channelFrom(account.platform ?? account.channel ?? account.type ?? conversation.platform ?? event.channel ?? event.platform ?? incoming.platform ?? incoming.channel ?? conversation.channel ?? payload.channel)
      // Zernio's webhook docs name this field `account.accountId` explicitly
      // (see the "Resolve message attachment" guide); `.id`/`._id` kept as a
      // fallback for the generic accounts-list shape.
      const zernioAccountId = text(account.accountId, account.id, account._id, incoming.accountId, event.accountId, event.account_id, conversation.accountId, payload.accountId)
      if (!externalEventId || !externalConversationId || !channel || !zernioAccountId || (eventType !== 'reaction.received' && !externalUserId)) continue

      const { data: connector, error: connectorError } = await db
        .from('omnichannel_connectors')
        .select('id, account_id, provider, display_name, zernio_account_id, queue_id')
        .eq('provider', `zernio_${channel}`)
        .eq('zernio_account_id', zernioAccountId)
        .neq('status', 'paused')
        .maybeSingle()
      if (connectorError) throw connectorError
      if (!connector) continue
      const typed = connector as Connector
      if (!(await registerReceipt(db, typed, externalEventId, eventType, event))) continue

      if (eventType === 'reaction.received') {
        const reaction = extractZernioReaction(reactionEvent)
        const reactionConversation = await db.from('conversations')
          .select('id, contact_id')
          .eq('account_id', typed.account_id)
          .eq('connector_id', typed.id)
          .eq('external_session_id', externalConversationId)
          .maybeSingle()
        if (reactionConversation.error) throw reactionConversation.error
        if (reactionConversation.data && reaction?.targetMessageId) {
          const target = await db.from('messages')
            .select('id, message_id, platform_message_id')
            .eq('conversation_id', reactionConversation.data.id)
            .or(`platform_message_id.eq.${reaction.targetMessageId},message_id.eq.zernio:${typed.id}:${reaction.targetMessageId},message_id.eq.zernio:out:${typed.id}:${reaction.targetMessageId}`)
            .maybeSingle()
          if (target.error) throw target.error
          if (target.data) {
            if (!target.data.platform_message_id && reaction.targetMessageId) {
              const { error } = await db.from('messages')
                .update({ platform_message_id: reaction.targetMessageId })
                .eq('id', target.data.id)
              if (error) throw error
            }
            if (reaction.emoji) {
              const { error } = await db.from('message_reactions').upsert({
                message_id: target.data.id,
                conversation_id: reactionConversation.data.id,
                actor_type: 'customer',
                actor_id: reactionConversation.data.contact_id,
                emoji: reaction.emoji,
              }, { onConflict: 'message_id,actor_type,actor_id' })
              if (error) throw error
            } else {
              const { error } = await db.from('message_reactions').delete()
                .eq('message_id', target.data.id)
                .eq('actor_type', 'customer')
                .eq('actor_id', reactionConversation.data.contact_id)
              if (error) throw error
            }
          }
        }
        await db.from('zernio_webhook_receipts').update({ outcome: 'processed', detail: 'Reacción del canal conectado procesada.', processed_at: new Date().toISOString() })
          .eq('connector_id', typed.id).eq('external_message_id', externalEventId)
        continue
      }

      const attachment = extractZernioMedia(record(incoming))
      try {
      // `message.message` is the documented text field for message.received
      // (https://docs.zernio.com/webhooks/inbox) — checked first; the rest
      // are fallbacks for the comment.received shape / older payloads. A
      // document/sticker with no caption falls back to its filename (mirrors
      // the native WhatsApp webhook's content_text convention) instead of the
      // generic placeholder, so the bubble shows something useful.
      const content = normalizeMetaText(text(incoming.message, incoming.text, incoming.content, incoming.body, comment.message, comment.text, event.text), attachment?.caption || attachment?.fileName)
      const auditUserId = await resolveAuditUserId(db, typed.account_id)
      const contactName = text(conversation.participantName, incoming.senderName, sender.name, sender.displayName, sender.fullName, comment.author_name, comment.authorName, participant.name)
      const contactEmail = text(sender.email, participant.email, incoming.email, comment.author_email, comment.authorEmail)
      // WhatsApp has no separate "phone" field on the sender/conversation —
      // the platform's own contact identity (senderId/participantId) IS the
      // E.164 phone number, so that's the phone-dedupe key on this channel.
      const contactPhone = text(sender.phone, participant.phone, incoming.phone, comment.author_phone, comment.authorPhone, channel === 'whatsapp' ? externalUserId : '')
      const webhookAvatarUrl = safeHttpsUrl(
        sender.avatarUrl ?? sender.avatar_url ?? sender.profilePicture ?? sender.profile_picture ?? sender.profileImage ?? sender.profile_image ?? sender.profilePhoto ?? sender.profile_photo ?? sender.picture ?? sender.pictureUrl ?? sender.picture_url ?? sender.imageUrl ?? sender.image_url ?? sender.photoUrl ?? sender.photo_url ??
        participant.avatarUrl ?? participant.avatar_url ?? participant.profilePicture ?? participant.profile_picture ?? participant.profileImage ?? participant.profile_image ?? participant.profilePhoto ?? participant.profile_photo ?? participant.picture ?? participant.pictureUrl ?? participant.picture_url ?? participant.imageUrl ?? participant.image_url ?? participant.photoUrl ?? participant.photo_url,
      )
      const contactAvatarUrl = webhookAvatarUrl ?? await getZernioParticipantPicture(externalConversationId, zernioAccountId).catch(() => null)
      const { contactId, created: contactCreated } = await resolveContact(
        db,
        typed,
        externalUserId,
        auditUserId,
        contactName || safeZernioContactName(channel, externalUserId),
        contactEmail || undefined,
        contactPhone || undefined,
        contactAvatarUrl ?? undefined,
      )
      const { data: rows, error: findError } = await db
        .from('conversations')
        .select('id, unread_count')
        .eq('account_id', typed.account_id)
        .eq('connector_id', typed.id)
        .eq('external_session_id', externalConversationId)
        .limit(1)
      if (findError) throw findError

      let conversationRow = rows?.[0]
      let created = false
      if (!conversationRow) {
        const { data, error } = await db
          .from('conversations')
          .insert({ account_id: typed.account_id, user_id: auditUserId, contact_id: contactId, channel_type: typed.provider, connector_id: typed.id, external_session_id: externalConversationId, channel_source_label: typed.display_name, queue_id: typed.queue_id })
          .select('id, unread_count')
          .single()
        if (error || !data) throw error ?? new Error('No se pudo crear la conversación entrante.')
        conversationRow = data
        created = true
      }

      const now = new Date().toISOString()
      const messageId = `zernio:${typed.id}:${externalMessageId || externalEventId}`
      // List Messages docs: the `id` field IS "the platform message id" —
      // this is what the attachment-resolve endpoint's messageId path
      // param expects. Falls back to whatever resolved externalMessageId
      // above (same candidate chain plus incoming.id/_id).
      const platformMessageId = text(incoming.platformMessageId, incoming.platform_message_id, incoming.nativeMessageId, incoming.externalMessageId, externalMessageId)
      const contentType = attachment && attachment.kind !== 'text' ? attachment.kind : 'text'
      const mediaUrl = attachment?.url ?? null
      // Counted before the insert so `first_inbound_message` automations see
      // an accurate value (covers contacts imported manually who write for
      // the first time through this channel).
      const { count: priorCustomerMessages } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversationRow.id)
        .eq('sender_type', 'customer')
      const isFirstInboundMessage = (priorCustomerMessages ?? 0) === 0
      const { error: messageError } = await db.from('messages').insert({
        conversation_id: conversationRow.id,
        sender_type: 'customer',
        content_type: contentType,
        content_text: content,
        media_url: mediaUrl,
        message_id: messageId,
        platform_message_id: platformMessageId,
        status: 'delivered',
        created_at: now,
      })
      if (messageError && !isUniqueViolation(messageError)) throw messageError

      const reaction = extractZernioReaction(record(incoming))
      if (reaction?.targetMessageId) {
        const targetInternal = await db.from('messages')
          .select('id')
          .eq('conversation_id', conversationRow.id)
          .eq('message_id', `zernio:${typed.id}:${reaction.targetMessageId}`)
          .maybeSingle()
        if (targetInternal.error) throw targetInternal.error
        if (targetInternal.data?.id) {
          if (!reaction.emoji) {
            const { error: deleteError } = await db.from('message_reactions')
              .delete()
              .eq('message_id', targetInternal.data.id)
              .eq('actor_type', 'customer')
              .eq('actor_id', contactId)
            if (deleteError) throw deleteError
          } else {
            const { error: upsertError } = await db.from('message_reactions').upsert({
              message_id: targetInternal.data.id,
              conversation_id: conversationRow.id,
              actor_type: 'customer',
              actor_id: contactId,
              emoji: reaction.emoji,
            }, { onConflict: 'message_id,actor_type,actor_id' })
            if (upsertError) throw upsertError
          }
        }
      }

      await db.from('conversations').update({ status: 'open', last_message_text: content, last_message_at: now, unread_count: (conversationRow.unread_count ?? 0) + 1, updated_at: now }).eq('id', conversationRow.id)
      // Broadcasts only exist for WhatsApp — flip the broadcast_recipients
      // row to `replied` so a Zernio-connected number's reply rate shows
      // up the same as a reply on the native (direct Meta) connection.
      if (typed.provider === 'zernio_whatsapp') {
        await flagBroadcastReplyIfAny(db, typed.account_id, contactId, conversationRow.id)
      }
      await db.rpc('auto_assign_inbound_conversation', { p_account_id: typed.account_id, p_conversation_id: conversationRow.id })
      const { contentAutomationRan } = await dispatchInboundAutomations({
        accountId: typed.account_id,
        contactId,
        conversationId: conversationRow.id,
        channelType: typed.provider as ChannelType,
        messageText: content,
        contactCreated,
        isFirstInboundMessage,
      })
      if (content.trim()) {
        await dispatchInboundToAiReply({
          accountId: typed.account_id,
          conversationId: conversationRow.id,
          contactId,
          configOwnerUserId: auditUserId,
          channelType: typed.provider as ChannelType,
          automationReplied: contentAutomationRan,
        })
      }
      await db.from('omnichannel_connectors').update({ status: 'active', last_event_at: now, last_error: null, updated_at: now }).eq('id', typed.id)
      if (created) await dispatchWebhookEvent(db, typed.account_id, 'conversation.created', { conversation_id: conversationRow.id, contact_id: contactId, channel_type: typed.provider, connector_id: typed.id })
      await dispatchWebhookEvent(db, typed.account_id, 'message.received', { conversation_id: conversationRow.id, contact_id: contactId, message_id: messageId, channel_type: typed.provider, content_type: contentType, text: content, media_url: mediaUrl })
      await db.from('zernio_webhook_receipts').update({ outcome: 'processed', detail: 'Mensaje del canal conectado agregado.', processed_at: now }).eq('connector_id', typed.id).eq('external_message_id', externalEventId)
      } catch (eventError) {
        // One poisoned event (e.g. a stale contact row colliding on a
        // unique constraint) must not abort the rest of the batch nor
        // make Zernio retry-and-fail this same payload forever.
        console.error('[zernio] message event failed, skipping:', eventError)
        await db.from('zernio_webhook_receipts').update({ outcome: 'failed', detail: eventError instanceof Error ? eventError.message.slice(0, 500) : 'Error desconocido', processed_at: new Date().toISOString() })
          .eq('connector_id', typed.id).eq('external_message_id', externalEventId)
      }
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[zernio] webhook failed', error)
    return NextResponse.json({ error: 'No se pudo procesar el evento.' }, { status: 500 })
  }
}
