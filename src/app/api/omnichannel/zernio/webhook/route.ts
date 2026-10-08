import { after, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { resolveAuditUserId } from '@/lib/api/v1/contacts'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchInboundAutomations } from '@/lib/automations/inbound'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { extractZernioMedia, extractZernioReaction, firstZernioContactName, isZernioPlaceholderName, normalizeMetaText, safeZernioContactName } from '@/lib/omnichannel/webhook-normalizer'
import { getZernioParticipantProfile, verifyZernioSignature, type ZernioChannel } from '@/lib/zernio/server'
import { persistZernioOutbound, zernioOutboundIsHuman } from '@/lib/zernio/outbound-message'
import { extractZernioPostContext } from '@/lib/zernio/post-context'
import { isValidStatusTransition } from '@/lib/whatsapp/recipient-status-ladder'
import { flagBroadcastReplyIfAny } from '@/lib/whatsapp/broadcast-reply-flag'
import { handleAgendaProConfirmationReply } from '@/lib/agendapro/confirmation'
import type { ChannelType } from '@/types'

export const dynamic = 'force-dynamic'
// Zernio requires a prompt HTTP acknowledgement. The actual handling (which
// can include an AI request) is registered with `after()` below.
export const maxDuration = 60

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

/**
 * Click-to-Messenger ad referral. Zernio forwards Meta's referral object
 * verbatim on `message.received.metadata.referral` (the common case — a
 * referral riding an actual inbound message) per
 * https://docs.zernio.com/webhooks/inbox#referralreceived: same
 * `ref`/`source`/`ad_id`/`ads_context_data` shape as the native Meta
 * webhook. Only Click-to-Messenger ad clicks (`source: 'ADS'`) carry an ad
 * to show; an ig.me/m.me link referral has nothing to display here.
 */
function extractZernioAdReferral(metadata: Json) {
  const referral = record(metadata.referral)
  if (text(referral.source) !== 'ADS') return null
  const context = record(referral.ads_context_data ?? referral.adsContextData)
  return {
    ad_id: text(referral.ad_id, referral.adId) || undefined,
    ref: text(referral.ref) || undefined,
    ad_title: text(context.ad_title, context.adTitle) || undefined,
    photo_url: safeHttpsUrl(context.photo_url ?? context.photoUrl),
    video_url: safeHttpsUrl(context.video_url ?? context.videoUrl),
    post_id: text(context.post_id, context.postId) || undefined,
    product_id: text(context.product_id, context.productId) || undefined,
  }
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
    if (avatarUrl) {
      const { error: avatarError } = await db.from('contacts')
        .update({ avatar_url: avatarUrl })
        .eq('id', contactId).eq('account_id', connector.account_id)
      if (avatarError) throw avatarError
    }
    // The first event of a conversation (often the Page's own automatic
    // reply, delivered as `message.sent` before Meta/Zernio has resolved
    // the customer's profile) can create the contact with a placeholder
    // like "Cliente Facebook 123456". Upgrade it as soon as a later event
    // carries the real name — never overwrite a name someone already set.
    if (!isZernioPlaceholderName(name)) {
      const { data: current, error: currentError } = await db
        .from('contacts')
        .select('name')
        .eq('id', contactId)
        .eq('account_id', connector.account_id)
        .maybeSingle()
      if (currentError) throw currentError
      if (current && isZernioPlaceholderName(current.name as string | null) && current.name !== name) {
        const { error: renameError } = await db.from('contacts')
          .update({ name, updated_at: new Date().toISOString() })
          .eq('id', contactId)
          .eq('account_id', connector.account_id)
        if (renameError) console.error('[zernio] could not update placeholder contact name:', renameError.message)
        await db.from('omnichannel_contact_identities')
          .update({ display_name: name })
          .eq('connector_id', connector.id)
          .eq('external_user_id', externalUserId)
      }
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
    if (!isZernioPlaceholderName(name) && isZernioPlaceholderName(existingName)) update.name = name
    if (avatarUrl) update.avatar_url = avatarUrl
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
    if (concurrent?.contact_id) {
      // Another event for the same customer (e.g. the inbound message and
      // the Page's automatic reply, delivered at the same instant) won the
      // race. The contact row this call just inserted is an orphan with no
      // conversation or identity pointing at it — remove it instead of
      // leaving a duplicate "Cliente Facebook …" in Contacts.
      if (contactCreated && concurrent.contact_id !== contactId) {
        await db.from('contacts').delete().eq('id', contactId).eq('account_id', connector.account_id)
      }
      return { contactId: concurrent.contact_id as string, created: false }
    }
  }
  return { contactId, created: contactCreated }
}

type ConversationRow = { id: string; unread_count: number | null; status: string | null }

/**
 * Find-or-create the NexoOmni conversation for a Zernio thread. An inbound
 * message and the Page's automatic reply (`message.sent`) for a brand-new
 * conversation are delivered at practically the same instant; both used to
 * insert and the loser hit the (account, connector, external_session_id)
 * unique index — marking that event failed and silently dropping it (the
 * customer's own message, in the worst case, leaving the thread with no
 * inbound message and a falsely "expired" 24h window). On that violation
 * we re-read the winner's row instead.
 */
async function findOrCreateZernioConversation(
  db: ReturnType<typeof admin>,
  connector: Connector,
  contactId: string,
  auditUserId: string,
  externalConversationId: string,
): Promise<{ row: ConversationRow; created: boolean }> {
  const find = async () => {
    const { data, error } = await db
      .from('conversations')
      .select('id, unread_count, status')
      .eq('account_id', connector.account_id)
      .eq('connector_id', connector.id)
      .eq('external_session_id', externalConversationId)
      .limit(1)
    if (error) throw error
    return (data?.[0] as ConversationRow | undefined) ?? null
  }

  const existing = await find()
  if (existing) return { row: existing, created: false }

  const { data, error } = await db
    .from('conversations')
    .insert({ account_id: connector.account_id, user_id: auditUserId, contact_id: contactId, channel_type: connector.provider, connector_id: connector.id, external_session_id: externalConversationId, channel_source_label: connector.display_name, queue_id: connector.queue_id })
    .select('id, unread_count, status')
    .single()
  if (!error && data) return { row: data as ConversationRow, created: true }
  if (isUniqueViolation(error)) {
    const raced = await find()
    if (raced) return { row: raced, created: false }
  }
  throw error ?? new Error('No se pudo crear la conversación del canal conectado.')
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
    const reason = text(account.reason, account.disconnectionType) || 'El canal se desconectó (desde Meta o desde la conexión).'
    await db.from('omnichannel_connectors')
      .update({ status: 'error', last_error: reason, updated_at: now })
      .eq('provider', `zernio_${channel}`)
      .eq('zernio_account_id', zernioAccountId)
  } catch (error) {
    console.error('[zernio] account lifecycle sync failed:', error)
  }
}

const WATERMARK_GRACE_MS = 10_000
const STATUS_RACE_RETRY_MS = 2_500

/**
 * Meta reports Messenger/Instagram delivery and read receipts as a
 * watermark ("every message sent up to this moment was delivered/read"),
 * not one receipt per message, so Zernio's single status event only names
 * one message. Without promoting the earlier outbound messages too, every
 * reply except the last stays on a grey tick forever. When the event's
 * message isn't one we stored (e.g. sent from Meta's own inbox before
 * NexoOmni saw it) the conversation + `statusAt` is used as the watermark.
 */
async function promoteOutboundWatermark(
  db: ReturnType<typeof admin>,
  status: 'delivered' | 'read',
  context: { conversation: Json; account: Json; statusAt: unknown },
  anchor: { conversationId: string; createdAt: string } | null,
) {
  try {
    let conversationId = anchor?.conversationId ?? null
    let watermark = anchor?.createdAt ?? null
    if (!conversationId) {
      const externalConversationId = text(context.conversation.id, context.conversation._id)
      const zernioAccountId = text(context.account.accountId, context.account.id, context.account._id)
      if (!externalConversationId || !zernioAccountId) return
      const { data: connectors, error: connectorError } = await db.from('omnichannel_connectors')
        .select('id')
        .eq('zernio_account_id', zernioAccountId)
        .like('provider', 'zernio_%')
      if (connectorError || !connectors?.length) return
      const { data: conversationRow, error: conversationError } = await db.from('conversations')
        .select('id')
        .in('connector_id', connectors.map((row) => row.id as string))
        .eq('external_session_id', externalConversationId)
        .limit(1)
        .maybeSingle()
      if (conversationError || !conversationRow) return
      conversationId = conversationRow.id as string
      // Our created_at is stamped after Zernio's send call returns, i.e. a
      // little later than Meta's own timestamp — allow for that round-trip
      // so the message the customer just read isn't left out.
      const statusAt = text(context.statusAt)
      const statusMs = statusAt ? Date.parse(statusAt) : Number.NaN
      watermark = new Date((Number.isNaN(statusMs) ? Date.now() : statusMs) + WATERMARK_GRACE_MS).toISOString()
    }
    if (!conversationId || !watermark) return
    const lowerStatuses = status === 'read' ? ['sending', 'sent', 'delivered'] : ['sending', 'sent']
    const { error } = await db.from('messages')
      .update({ status })
      .eq('conversation_id', conversationId)
      .neq('sender_type', 'customer')
      .lte('created_at', watermark)
      .in('status', lowerStatuses)
    if (error) console.error('[zernio] could not apply status watermark:', error.message)
  } catch (error) {
    console.error('[zernio] status watermark failed:', error)
  }
}

/**
 * Mirrors an OUTBOUND WhatsApp delivery-status webhook onto both
 * `messages` (the ticks shown in the inbox thread — ✓ sent, ✓✓
 * delivered, blue ✓✓ read) and `broadcast_recipients` (mass-send stats).
 * Zernio reports this lifecycle for every outbound message, not just
 * broadcast sends, so both mirrors are attempted independently — a miss
 * on one (e.g. a regular 1:1 send has no broadcast_recipients row) must
 * not skip the other.
 * https://docs.zernio.com/webhooks/inbox
 */
async function handleOutboundStatusEvent(
  db: ReturnType<typeof admin>,
  eventType: 'message.delivered' | 'message.read' | 'message.failed',
  message: Json,
  errorInfo: Json,
  context: { conversation: Json; account: Json; statusAt: unknown } = { conversation: {}, account: {}, statusAt: null },
) {
  // Try every id shape Zernio might use for this message — the one we
  // stored as `whatsapp_message_id` (Zernio's own message id, returned
  // by Create conversation) may not be the first field this payload
  // happens to carry, so match against all of them instead of just
  // the first non-empty candidate.
  const candidateIds = [message.id, message.platformMessageId, message.platform_message_id, message._id]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
  const status = eventType === 'message.delivered' ? 'delivered' : eventType === 'message.read' ? 'read' : 'failed'
  const now = new Date().toISOString()
  const statusChannel = channelFrom(message.platform ?? context.account.platform ?? context.conversation.platform)
  const watermarkStatus = status !== 'failed' && (statusChannel === 'facebook' || statusChannel === 'instagram') ? status : null
  if (candidateIds.length === 0) {
    console.warn(`[zernio] ${eventType} webhook carried no usable message id — payload:`, JSON.stringify(message).slice(0, 500))
    if (watermarkStatus) await promoteOutboundWatermark(db, watermarkStatus, context, null)
    return
  }

  // 1) Mirror onto the message itself — this is what the inbox thread's
  //    ticks actually render (message-bubble.tsx's StatusIcon). Every
  //    outbound Zernio send stores its `platform_message_id` (see
  //    zernio/send/route.ts), so this matches regardless of whether the
  //    message also belongs to a broadcast.
  const lookupStatusTarget = async () => {
    const byPlatformId = await db
      .from('messages')
      .select('id, status, conversation_id, created_at')
      .neq('sender_type', 'customer')
      .in('platform_message_id', candidateIds)
      .limit(1)
      .maybeSingle()
    if (byPlatformId.data || byPlatformId.error) return byPlatformId
    return db.from('messages').select('id, status, conversation_id, created_at')
      .neq('sender_type', 'customer').in('zernio_internal_message_id', candidateIds)
      .limit(1).maybeSingle()
  }
  let { data: matchedMessage, error: messageFetchError } = await lookupStatusTarget()
  // A customer watching the thread reads the reply within a second — the
  // read event can beat send/route.ts persisting the row. Retry once.
  if (!matchedMessage && !messageFetchError && watermarkStatus) {
    await new Promise((resolve) => setTimeout(resolve, STATUS_RACE_RETRY_MS))
    ;({ data: matchedMessage, error: messageFetchError } = await lookupStatusTarget())
  }
  if (messageFetchError) {
    console.error('[zernio] could not look up message for status update:', messageFetchError.message)
  } else if (matchedMessage && isValidStatusTransition(matchedMessage.status, status)) {
    // `messages` has no error_message column (unlike broadcast_recipients)
    // — the failure reason is only ever surfaced on the broadcast mirror.
    const { error: messageUpdateError } = await db.from('messages').update({ status }).eq('id', matchedMessage.id)
    if (messageUpdateError) console.error('[zernio] could not update message status:', messageUpdateError.message)
  }
  if (!messageFetchError && watermarkStatus) {
    await promoteOutboundWatermark(db, watermarkStatus, context, matchedMessage
      ? { conversationId: matchedMessage.conversation_id as string, createdAt: matchedMessage.created_at as string }
      : null)
  }

  // 2) Mirror onto broadcast_recipients — only present for broadcast
  //    sends, so a miss here is expected and not logged as an error.
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
  if (!recipient) return
  if (!isValidStatusTransition(recipient.status, status)) {
    console.warn(`[zernio] ${eventType} webhook ignored — invalid transition ${recipient.status} -> ${status} for recipient ${recipient.id}`)
    return
  }

  const update: Record<string, unknown> = { status }
  if (status === 'delivered') update.delivered_at = now
  if (status === 'read') update.read_at = now
  if (status === 'failed') update.error_message = text(errorInfo.message, errorInfo.title) || 'El canal conectado reportó que el envío falló.'

  const { error: updateError } = await db.from('broadcast_recipients').update(update).eq('id', recipient.id)
  if (updateError) console.error('[zernio] could not update broadcast recipient status:', updateError.message)
}

/**
 * message.edited — the customer edited a message they already sent
 * (Instagram, Facebook Messenger, Telegram, WhatsApp per
 * docs.zernio.com/webhooks/inbox#messageedited). `message.text` is
 * already the latest version; no edit history is kept here, matching
 * the native Meta path (migration 143's `edited_at`).
 */
async function handleMessageEditedEvent(db: ReturnType<typeof admin>, message: Json, editedAt: unknown) {
  const candidateIds = [message.id, message.platformMessageId, message.platform_message_id, message._id]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
  const newText = typeof message.text === 'string' ? message.text : null
  if (candidateIds.length === 0 || newText === null) return
  const editedAtIso = typeof editedAt === 'string' && editedAt.trim() ? editedAt : new Date().toISOString()

  const { data: matchedMessage, error: fetchError } = await db
    .from('messages')
    .select('id')
    .eq('sender_type', 'customer')
    .in('platform_message_id', candidateIds)
    .limit(1)
    .maybeSingle()
  if (fetchError) {
    console.error('[zernio] could not look up message for edit:', fetchError.message)
    return
  }
  if (!matchedMessage) return
  const { error: updateError } = await db.from('messages')
    .update({ content_text: newText, edited_at: editedAtIso })
    .eq('id', matchedMessage.id)
  if (updateError) console.error('[zernio] could not update edited message:', updateError.message)
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

  const eventIdHeader = request.headers.get('x-zernio-event-id')
  after(async () => {
    await processZernioWebhook(payload, eventIdHeader)
  })
  return NextResponse.json({ ok: true })
}

async function processZernioWebhook(payload: Json, eventIdHeader: string | null) {
  const db = admin()
  try {
    for (const event of entries(payload)) {
      const eventType = text(event.event, payload.event)

      if (eventType === 'account.connected' || eventType === 'account.disconnected') {
        await handleAccountLifecycleEvent(db, eventType, record(event.account))
        continue
      }
      if (eventType === 'message.delivered' || eventType === 'message.read' || eventType === 'message.failed') {
        await handleOutboundStatusEvent(db, eventType, record(event.message), record(event.error), {
          conversation: record(event.conversation),
          account: record(event.account),
          statusAt: event.statusAt,
        })
        continue
      }
      if (eventType === 'message.edited') {
        await handleMessageEditedEvent(db, record(event.message), event.editedAt)
        continue
      }
      if (eventType !== 'message.received' && eventType !== 'comment.received' && eventType !== 'reaction.received' && eventType !== 'message.sent') continue

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
      const externalEventId = text(event.id, eventIdHeader, externalMessageId)
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

      // `message.sent` — "An outgoing message was sent from the inbox,
      // through the API or the dashboard" (docs.zernio.com/webhooks/inbox).
      // Fires for EVERY outgoing message Zernio observes, including ones
      // sent natively on the platform (a human answering straight from the
      // Facebook/Instagram Page inbox, or — on WhatsApp — the Business app
      // itself or Meta Business Agent), not only sends made through
      // Zernio's own API/dashboard. Our own sends (src/app/api/omnichannel/
      // zernio/send/route.ts) already insert the message synchronously
      // when we call Zernio's send API, keyed on the same `platform_message_id`
      // this event reports — so the first step is always "is this already
      // ours?" before inserting anything, to avoid a duplicate bubble.
      //
      // Capturing these is what keeps NexoOmni's copy of the conversation
      // complete when someone replies outside NexoOmni (e.g. straight from
      // Meta's own inbox) — otherwise Nexo Memory, QA scoring and the AI's
      // own "a human already replied" gate (src/lib/ai/auto-reply.ts) all
      // work off an incomplete thread.
      if (eventType === 'message.sent') {
        try {
          const internalMessageId = text(incoming.id, incoming._id) || null
          const platformMessageId = text(incoming.platformMessageId, incoming.platform_message_id) || null

          // `message.sender` on this event IS the business account, not the
          // customer — reading it to name/update the contact would relabel
          // the customer's record with the business's own name (explicitly
          // called out in Zernio's docs). The customer is always
          // `conversation.participant*`, populated in both directions.
          const auditUserId = await resolveAuditUserId(db, typed.account_id)
          let participantName = firstZernioContactName(conversation.participantName, participant.name)
          let participantPicture: string | undefined
          if (isZernioPlaceholderName(participantName)) {
            // Usually the Page's automatic greeting, sent before Zernio has
            // resolved the customer's profile — ask Zernio for it instead of
            // naming the contact "Cliente Facebook 123456".
            const profile = await getZernioParticipantProfile(externalConversationId, zernioAccountId).catch((error) => {
              console.error('[zernio] participant profile lookup failed:', error)
              return null
            })
            participantName = profile?.name ?? ''
            participantPicture = profile?.picture ?? undefined
          }
          const outgoingContactName = participantName || safeZernioContactName(channel, externalUserId)
          const outgoingContactPhone = channel === 'whatsapp' ? externalUserId : ''
          const { contactId: outgoingContactId } = await resolveContact(
            db, typed, externalUserId, auditUserId, outgoingContactName, undefined, outgoingContactPhone || undefined, participantPicture,
          )

          const { row: outConversation } = await findOrCreateZernioConversation(db, typed, outgoingContactId, auditUserId, externalConversationId)
          const outConversationId = outConversation.id

          const outAttachment = extractZernioMedia(incoming)
          const outContent = normalizeMetaText(text(incoming.text), outAttachment?.caption || outAttachment?.fileName)
          const outContentType = outAttachment && outAttachment.kind !== 'text' ? outAttachment.kind : 'text'
          const sentAt = text(incoming.sentAt) || new Date().toISOString()

          const human = zernioOutboundIsHuman(incoming)
          await persistZernioOutbound(db, {
            accountId: typed.account_id, connectorId: typed.id, conversationId: outConversationId,
            internalId: internalMessageId, platformId: platformMessageId, local: false,
            message: {
              sender_type: human ? 'agent' : 'bot',
              sender_id: human ? auditUserId : null,
              content_type: outContentType,
              content_text: outContent,
              media_url: outAttachment?.url ?? null,
              created_at: sentAt,
            },
          })

          await db.from('conversations').update({ last_message_text: outContent || `[${outContentType}]`, last_message_at: sentAt, updated_at: new Date().toISOString() }).eq('id', outConversationId)
          await db.from('zernio_webhook_receipts').update({ outcome: 'processed', detail: 'Mensaje saliente del canal conectado conciliado.', processed_at: new Date().toISOString() })
            .eq('connector_id', typed.id).eq('external_message_id', externalEventId)
        } catch (eventError) {
          console.error('[zernio] message.sent handling failed, skipping:', eventError)
          await db.from('zernio_webhook_receipts').update({ outcome: 'failed', detail: eventError instanceof Error ? eventError.message.slice(0, 500) : 'Error desconocido', processed_at: new Date().toISOString() })
            .eq('connector_id', typed.id).eq('external_message_id', externalEventId)
        }
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
      const contactName = firstZernioContactName(sender.name, incoming.senderName, sender.displayName, sender.fullName, comment.author_name, comment.authorName, participant.name, conversation.participantName)
      const contactEmail = text(sender.email, participant.email, incoming.email, comment.author_email, comment.authorEmail)
      // WhatsApp has no separate "phone" field on the sender/conversation —
      // the platform's own contact identity (senderId/participantId) IS the
      // E.164 phone number, so that's the phone-dedupe key on this channel.
      const contactPhone = text(sender.phone, participant.phone, incoming.phone, comment.author_phone, comment.authorPhone, channel === 'whatsapp' ? externalUserId : '')
      const webhookAvatarUrl = safeHttpsUrl(
        sender.avatarUrl ?? sender.avatar_url ?? sender.profilePicture ?? sender.profile_picture ?? sender.profileImage ?? sender.profile_image ?? sender.profilePhoto ?? sender.profile_photo ?? sender.picture ?? sender.pictureUrl ?? sender.picture_url ?? sender.imageUrl ?? sender.image_url ?? sender.photoUrl ?? sender.photo_url ??
        participant.avatarUrl ?? participant.avatar_url ?? participant.profilePicture ?? participant.profile_picture ?? participant.profileImage ?? participant.profile_image ?? participant.profilePhoto ?? participant.profile_photo ?? participant.picture ?? participant.pictureUrl ?? participant.picture_url ?? participant.imageUrl ?? participant.image_url ?? participant.photoUrl ?? participant.photo_url,
      )
      // One lookup covers both gaps: a missing avatar (pre-existing
      // behavior) and a missing name, which Zernio frequently fills in on
      // its side a moment after the webhook was built.
      const profile = !webhookAvatarUrl || isZernioPlaceholderName(contactName)
        ? await getZernioParticipantProfile(externalConversationId, zernioAccountId).catch((error) => {
          console.error('[zernio] participant profile lookup failed:', error)
          return null
        })
        : null
      const contactAvatarUrl = webhookAvatarUrl ?? profile?.picture ?? null
      const resolvedContactName = isZernioPlaceholderName(contactName) ? profile?.name || contactName : contactName
      const { contactId, created: contactCreated } = await resolveContact(
        db,
        typed,
        externalUserId,
        auditUserId,
        resolvedContactName || safeZernioContactName(channel, externalUserId),
        contactEmail || undefined,
        contactPhone || undefined,
        contactAvatarUrl ?? undefined,
      )
      const { row: conversationRow, created } = await findOrCreateZernioConversation(db, typed, contactId, auditUserId, externalConversationId)

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
      // A customer writing again after the thread was closed starts a new
      // relationship cycle, so welcome flows run again.
      const isFirstInboundMessage =
        (priorCustomerMessages ?? 0) === 0 || conversationRow.status === 'closed'
      // Swipe-reply/quote context — same purpose as the native WhatsApp
      // webhook's `message.context.id` handling (renders a quoted preview
      // above the bubble, e.g. "replying to: [Plantilla] Hola SPA...").
      // Zernio's exact metadata key isn't pinned down in their docs beyond
      // "present when the message is ... a quote-reply to an earlier
      // message" — checked defensively against every plausible shape; a
      // miss just leaves reply_to_message_id null like before, no
      // regression either way.
      const replyMetadata = record(incoming.metadata)
      const replyContext = record(replyMetadata.context ?? replyMetadata.quoted ?? replyMetadata.repliedTo)
      const quotedPlatformMessageId = text(
        replyMetadata.replyTo,
        replyMetadata.replyToId,
        replyMetadata.quotedMessageId,
        replyMetadata.quoted_message_id,
        replyContext.id,
        replyContext.platformMessageId,
      )
      let replyToInternalId: string | null = null
      if (quotedPlatformMessageId) {
        const { data: quotedRow, error: quotedError } = await db
          .from('messages')
          .select('id')
          .eq('conversation_id', conversationRow.id)
          .or(`platform_message_id.eq.${quotedPlatformMessageId},message_id.eq.zernio:${typed.id}:${quotedPlatformMessageId}`)
          .maybeSingle()
        if (quotedError) console.error('[zernio] reply context lookup failed:', quotedError.message)
        else replyToInternalId = quotedRow?.id ?? null
      }
      const inboundRow: Record<string, unknown> = {
        conversation_id: conversationRow.id,
        sender_type: 'customer',
        content_type: contentType,
        content_text: content,
        media_url: mediaUrl,
        message_id: messageId,
        platform_message_id: platformMessageId,
        reply_to_message_id: replyToInternalId,
        status: 'delivered',
        created_at: now,
        // Which of the contact's numbers actually sent this — only
        // meaningful on WhatsApp, where the participant id IS the phone
        // (see contactPhone above). Migration 131.
        sender_phone: channel === 'whatsapp' ? (contactPhone || null) : null,
        ad_referral: extractZernioAdReferral(replyMetadata),
      }
      const postContext = channel === 'whatsapp' ? null : extractZernioPostContext(record(incoming), replyMetadata)
      let { error: messageError } = await db.from('messages').insert(postContext ? { ...inboundRow, post_context: postContext } : inboundRow)
      // Never lose an inbound message because migration 145 hasn't been
      // applied yet — retry without the optional context column.
      if (postContext && messageError && (messageError.code === 'PGRST204' || messageError.code === '42703')) {
        console.error('[zernio] messages.post_context missing (apply migration 145); saving without post context.')
        ;({ error: messageError } = await db.from('messages').insert(inboundRow))
      }
      if (messageError && !isUniqueViolation(messageError)) throw messageError
      // A Messenger/Instagram customer can only reply from inside the open
      // thread, which marks it seen in Meta's own UI — but Meta does not
      // always emit a fresh read watermark for messages sent seconds
      // earlier, which left the last agent reply stuck on grey ticks.
      if (!messageError && (channel === 'facebook' || channel === 'instagram')) {
        await promoteOutboundWatermark(db, 'read', { conversation: {}, account: {}, statusAt: null }, { conversationId: conversationRow.id, createdAt: now })
      }

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
        // AgendaPro 24h confirmation: same SI/NO handling as the native
        // WhatsApp webhook — a Zernio-only account sends its reminders
        // through this number, so the client's reply arrives here.
        if (contentType === 'text' && content.trim()) {
          await handleAgendaProConfirmationReply(db, typed.account_id, contactId, content).catch((error) => {
            console.error('[agendapro] could not process a confirmation reply (zernio):', error)
          })
        }
      }
      await db.rpc('auto_assign_inbound_conversation', { p_account_id: typed.account_id, p_conversation_id: conversationRow.id })
      // Flows run before automations and the AI: a customer navigating a bot
      // menu is not sending a fresh trigger word.
      const { consumed: flowConsumed } = await dispatchInboundToFlows({
        accountId: typed.account_id,
        userId: auditUserId,
        contactId,
        conversationId: conversationRow.id,
        channelType: typed.provider as ChannelType,
        message: { kind: 'text', text: content, meta_message_id: messageId },
        isFirstInboundMessage,
      })
      const { contentAutomationRan } = await dispatchInboundAutomations({
        accountId: typed.account_id,
        contactId,
        conversationId: conversationRow.id,
        channelType: typed.provider as ChannelType,
        messageText: content,
        contactCreated,
        isFirstInboundMessage,
        flowConsumed,
      })
      if (!flowConsumed && content.trim()) {
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
  } catch (error) {
    console.error('[zernio] webhook failed', error)
  }
}
