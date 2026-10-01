import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/whatsapp/encryption'
import { verifyAgendaProSignature } from '@/lib/agendapro/server'
import { recordAgendaProMemoryEvent } from '@/lib/agendapro/memory'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { resolveAuditUserId } from '@/lib/api/v1/contacts'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

type Json = Record<string, unknown>

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Falta la configuración del servidor.')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

function record(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function id(value: unknown) {
  if (typeof value === 'number') return String(value)
  return text(value)
}

/** Resolves (or creates) the contact for an AgendaPro client, mirroring the
 *  phone-first/email-fallback convention every other webhook in this
 *  codebase already uses — see src/app/api/omnichannel/zernio/webhook/route.ts. */
async function resolveContactForClient(db: ReturnType<typeof admin>, accountId: string, client: Json): Promise<string | null> {
  const phone = text(client.phone)
  const email = text(client.email)
  const name = [text(client.first_name), text(client.last_name)].filter(Boolean).join(' ').trim() || 'Cliente AgendaPro'

  const phoneMatch = phone ? await findExistingContact(db, accountId, phone) : null
  let emailMatch: { id: string } | null = null
  if (!phoneMatch && email) {
    const { data, error } = await db.from('contacts').select('id')
      .eq('account_id', accountId).eq('email_normalized', email.toLowerCase()).limit(2)
    if (error) console.error('[agendapro] could not match contact by email:', error.message)
    else if (data?.length === 1) emailMatch = data[0]
  }
  if (phoneMatch) return phoneMatch.id
  if (emailMatch) return emailMatch.id
  if (!phone && !email) return null

  const auditUserId = await resolveAuditUserId(db, accountId)
  const { data, error } = await db.from('contacts').insert({
    account_id: accountId, user_id: auditUserId, name,
    phone: phone ?? `agendapro:${id(client.id) ?? 'sin-id'}`,
    email: email ?? null,
  }).select('id').single()
  if (error) {
    if (isUniqueViolation(error) && phone) {
      const retry = await findExistingContact(db, accountId, phone)
      if (retry) return retry.id
    }
    console.error('[agendapro] could not create contact:', error.message)
    return null
  }
  return data.id as string
}

async function upsertAgendaProClient(db: ReturnType<typeof admin>, accountId: string, data: Json) {
  const clientId = id(data.id)
  if (!clientId) return
  const contactId = await resolveContactForClient(db, accountId, data)
  const { error } = await db.from('agendapro_clients').upsert({
    account_id: accountId, contact_id: contactId, agendapro_client_id: clientId, synced_at: new Date().toISOString(),
  }, { onConflict: 'account_id,agendapro_client_id' })
  if (error) console.error('[agendapro] could not upsert agendapro_clients:', error.message)
}

async function linkedContactId(db: ReturnType<typeof admin>, accountId: string, agendaproClientId: string | null) {
  if (!agendaproClientId) return null
  const { data } = await db.from('agendapro_clients').select('contact_id')
    .eq('account_id', accountId).eq('agendapro_client_id', agendaproClientId).maybeSingle()
  return data?.contact_id ?? null
}

/** Booking webhook payloads only carry a subset of the Booking resource
 *  (id/start_time/end_time/service_id/client_id/location_id, per AgendaPro's
 *  own docs example) — richer fields (names, status, price) are left null
 *  here and only ever populated by a direct `GET /v3/bookings` call (used by
 *  the dashboard read routes), not guessed from the webhook alone. */
async function upsertAgendaProBooking(db: ReturnType<typeof admin>, accountId: string, data: Json) {
  const bookingId = id(data.id)
  if (!bookingId) return
  const agendaproClientId = id(data.client_id)
  const contactId = await linkedContactId(db, accountId, agendaproClientId)
  const { error } = await db.from('agendapro_bookings').upsert({
    account_id: accountId,
    contact_id: contactId,
    agendapro_booking_id: bookingId,
    agendapro_client_id: agendaproClientId,
    location_id: id(data.location_id),
    start_time: text(data.start_time),
    end_time: text(data.end_time),
    status_id: typeof data.status_id === 'number' ? data.status_id : null,
    price: text(data.price),
    agendapro_created_at: text(data.created_at),
    agendapro_updated_at: text(data.updated_at),
    synced_at: new Date().toISOString(),
  }, { onConflict: 'account_id,agendapro_booking_id' })
  if (error) { console.error('[agendapro] could not upsert agendapro_bookings:', error.message); return }

  if (contactId) {
    const when = text(data.start_time)
    await recordAgendaProMemoryEvent({
      accountId, contactId, sourceId: bookingId,
      summary: when ? `Reserva en AgendaPro para el ${when}.` : 'Reserva creada/actualizada en AgendaPro.',
    })
  }
}

async function upsertAgendaProPaymentRequest(db: ReturnType<typeof admin>, accountId: string, data: Json, eventType: string) {
  const paymentRequestId = id(data.id)
  if (!paymentRequestId) return
  const status = eventType === 'payment_request.paid' ? 'paid' : 'expired'
  const amount = text(data.amount)
  const params = record(data.params)
  const { error } = await db.from('agendapro_payment_requests').upsert({
    account_id: accountId,
    agendapro_payment_request_id: paymentRequestId,
    status,
    amount,
    payment_url: text(params.checkout_url),
    expires_at: text(params.expires_at),
    agendapro_created_at: text(data.created_at),
    synced_at: new Date().toISOString(),
  }, { onConflict: 'account_id,agendapro_payment_request_id' })
  if (error) console.error('[agendapro] could not upsert agendapro_payment_requests:', error.message)
}

async function processAgendaProEvent(db: ReturnType<typeof admin>, accountId: string, eventType: string, data: Json) {
  switch (eventType) {
    case 'booking.created':
    case 'booking.updated':
      await upsertAgendaProBooking(db, accountId, data)
      return
    case 'client.created':
    case 'client.updated':
      await upsertAgendaProClient(db, accountId, data)
      return
    case 'payment_request.paid':
    case 'payment_request.expired':
      await upsertAgendaProPaymentRequest(db, accountId, data, eventType)
      return
    default:
      // service.updated and anything else: catalog data is fetch-through
      // by design (no local cache), nothing to persist.
      return
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ webhookToken: string }> }) {
  const { webhookToken } = await params
  const raw = await request.text()
  const db = admin()

  const { data: config, error: configError } = await db.from('agendapro_configs')
    .select('account_id, encrypted_webhook_secret')
    .eq('webhook_token', webhookToken)
    .maybeSingle()
  if (configError) {
    console.error('[agendapro] could not look up webhook config:', configError.message)
    return NextResponse.json({ error: 'Error interno.' }, { status: 500 })
  }
  if (!config) return NextResponse.json({ error: 'Webhook no encontrado.' }, { status: 404 })
  if (!config.encrypted_webhook_secret) {
    return NextResponse.json({ error: 'El webhook de AgendaPro aún no tiene un secreto configurado en NexoOmni.' }, { status: 401 })
  }

  const secret = decrypt(config.encrypted_webhook_secret)
  const verified = verifyAgendaProSignature(
    request.headers.get('webhook-id'),
    request.headers.get('webhook-timestamp'),
    raw,
    request.headers.get('webhook-signature'),
    secret,
  )
  if (!verified) return NextResponse.json({ error: 'Firma de webhook inválida.' }, { status: 401 })

  let payload: Json
  try {
    payload = JSON.parse(raw) as Json
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }

  const accountId = config.account_id as string
  const eventType = text(payload.type)
  const webhookId = request.headers.get('webhook-id')!
  if (!eventType) return NextResponse.json({ ok: true })

  const { data: receipt, error: receiptError } = await db.from('agendapro_webhook_receipts')
    .insert({ account_id: accountId, webhook_id: webhookId, event_type: eventType })
    .select('id')
    .maybeSingle()
  if (receiptError) {
    if (isUniqueViolation(receiptError)) return NextResponse.json({ ok: true }) // already delivered once
    console.error('[agendapro] could not register webhook receipt:', receiptError.message)
  }

  try {
    await processAgendaProEvent(db, accountId, eventType, record(payload.data))
    if (receipt) await db.from('agendapro_webhook_receipts').update({ outcome: 'processed', processed_at: new Date().toISOString() }).eq('id', receipt.id)
  } catch (error) {
    console.error('[agendapro] webhook processing failed:', error)
    if (receipt) {
      await db.from('agendapro_webhook_receipts')
        .update({ outcome: 'failed', detail: error instanceof Error ? error.message.slice(0, 500) : 'Error desconocido', processed_at: new Date().toISOString() })
        .eq('id', receipt.id)
    }
    // Still 200 — a transient DB hiccup shouldn't burn through AgendaPro's
    // limited retry budget (it auto-disables the webhook after repeated failures).
  }
  return NextResponse.json({ ok: true })
}
