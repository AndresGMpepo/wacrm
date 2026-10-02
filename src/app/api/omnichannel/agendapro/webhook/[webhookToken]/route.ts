import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

import { recordAgendaProMemoryEvent } from '@/lib/agendapro/memory'
import { correctAgendaProInstant } from '@/lib/agendapro/time'
import { getAgendaProTimezone } from '@/lib/agendapro/server'
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

async function upsertAgendaProClient(db: ReturnType<typeof admin>, accountId: string, client: Json) {
  const clientId = id(client.id)
  if (!clientId) return
  const contactId = await resolveContactForClient(db, accountId, client)
  const { error } = await db.from('agendapro_clients').upsert({
    account_id: accountId, contact_id: contactId, agendapro_client_id: clientId, synced_at: new Date().toISOString(),
  }, { onConflict: 'account_id,agendapro_client_id' })
  if (error) console.error('[agendapro] could not upsert agendapro_clients:', error.message)
  return contactId
}

async function linkedContactId(db: ReturnType<typeof admin>, accountId: string, agendaproClientId: string | null) {
  if (!agendaproClientId) return null
  const { data } = await db.from('agendapro_clients').select('contact_id')
    .eq('account_id', accountId).eq('agendapro_client_id', agendaproClientId).maybeSingle()
  return data?.contact_id ?? null
}

/** `resource` on a booking.* event is the FULL Booking shape (confirmed from
 *  the webhook doc's own examples: id/service_provider_id/service_id/
 *  location_id/price/status_id/service/service_provider/location/status/
 *  start/end/notes/company_comment/payed_state/client{...}) — richer than
 *  Connect v3's partial payload, so no separate enrichment call is needed. */
async function upsertAgendaProBooking(db: ReturnType<typeof admin>, accountId: string, booking: Json) {
  const bookingId = id(booking.id)
  if (!bookingId) return
  const client = record(booking.client)
  // The webhook's embedded client object omits `id` in the documented
  // examples — fall back to linking by whatever agendapro_clients mapping
  // already exists for this booking's own client sub-object if it ever
  // does carry one, else leave unlinked (best-effort cache, not guaranteed).
  const agendaproClientId = id(client.id)
  const contactId = await linkedContactId(db, accountId, agendaproClientId)
  const timezone = await getAgendaProTimezone(db, accountId)
  const rawStart = text(booking.start)
  const rawEnd = text(booking.end)
  const { error } = await db.from('agendapro_bookings').upsert({
    account_id: accountId,
    contact_id: contactId,
    agendapro_booking_id: bookingId,
    agendapro_client_id: agendaproClientId,
    service_name: text(booking.service),
    provider_name: text(booking.service_provider),
    location_id: id(booking.location_id),
    location_name: text(booking.location),
    // AgendaPro's start/end carry a "Z" but are actually the clinic's own
    // local wall-clock time (see src/lib/agendapro/time.ts) — corrected
    // here before this timestamptz column ever sees the raw value.
    start_time: rawStart ? correctAgendaProInstant(rawStart, timezone) : null,
    end_time: rawEnd ? correctAgendaProInstant(rawEnd, timezone) : null,
    status_id: typeof booking.status_id === 'number' ? booking.status_id : null,
    status_name: text(booking.status),
    price: booking.price != null ? String(booking.price) : null,
    synced_at: new Date().toISOString(),
  }, { onConflict: 'account_id,agendapro_booking_id' })
  if (error) { console.error('[agendapro] could not upsert agendapro_bookings:', error.message); return }

  if (contactId) {
    const when = text(booking.start)
    await recordAgendaProMemoryEvent({
      accountId, contactId, sourceId: bookingId,
      summary: when ? `Reserva en AgendaPro para el ${when}.` : 'Reserva creada/actualizada en AgendaPro.',
    })
  }
}

/** `resource_type` values for client/payment events are inferred from the
 *  webhook guide's prose ("reservas, clientes, pagos y fichas") — only
 *  `Booking`'s shape is actually confirmed with a documented payload
 *  example. Matched case-insensitively/defensively; an unrecognized
 *  resource_type is a no-op, not a guessed write. */
async function processAgendaProEvent(db: ReturnType<typeof admin>, accountId: string, resourceType: string, resource: Json) {
  const normalized = resourceType.toLowerCase()
  if (normalized === 'booking') {
    await upsertAgendaProBooking(db, accountId, resource)
    return
  }
  if (normalized === 'client') {
    await upsertAgendaProClient(db, accountId, resource)
  }
  // Payment/ficha events: not wired up — their resource_type string and
  // exact field shape were never confirmed from AgendaPro's own docs.
}

export async function POST(request: Request, { params }: { params: Promise<{ webhookToken: string }> }) {
  const { webhookToken } = await params
  const raw = await request.text()
  const db = admin()

  const { data: config, error: configError } = await db.from('agendapro_configs')
    .select('account_id')
    .eq('webhook_token', webhookToken)
    .maybeSingle()
  if (configError) {
    console.error('[agendapro] could not look up webhook config:', configError.message)
    return NextResponse.json({ error: 'Error interno.' }, { status: 500 })
  }
  // AgendaPro V1 has no documented webhook signature scheme — the random
  // `webhookToken` in the URL path IS the entire trust boundary here
  // (unlike Zernio/Connect v3, which sign every request with a secret).
  if (!config) return NextResponse.json({ error: 'Webhook no encontrado.' }, { status: 404 })

  let payload: Json
  try {
    payload = JSON.parse(raw) as Json
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }

  const accountId = config.account_id as string
  const resourceType = text(payload.resource_type)
  const requestUuid = text(payload.request_uuid) ?? crypto.randomUUID()
  if (!resourceType) return NextResponse.json({ ok: true })

  const { data: receipt, error: receiptError } = await db.from('agendapro_webhook_receipts')
    .insert({ account_id: accountId, request_uuid: requestUuid, event_type: `${resourceType}.${text(payload.trigger) ?? 'unknown'}` })
    .select('id')
    .maybeSingle()
  if (receiptError) {
    if (isUniqueViolation(receiptError)) return NextResponse.json({ ok: true }) // already delivered once
    console.error('[agendapro] could not register webhook receipt:', receiptError.message)
  }

  try {
    await processAgendaProEvent(db, accountId, resourceType, record(payload.resource))
    if (receipt) await db.from('agendapro_webhook_receipts').update({ outcome: 'processed', processed_at: new Date().toISOString() }).eq('id', receipt.id)
  } catch (error) {
    console.error('[agendapro] webhook processing failed:', error)
    if (receipt) {
      await db.from('agendapro_webhook_receipts')
        .update({ outcome: 'failed', detail: error instanceof Error ? error.message.slice(0, 500) : 'Error desconocido', processed_at: new Date().toISOString() })
        .eq('id', receipt.id)
    }
    // Still 200 — AgendaPro's own retry/disable policy for this legacy
    // webhook isn't documented, but failing loudly here would only risk
    // losing future deliveries for a transient DB hiccup.
  }
  return NextResponse.json({ ok: true })
}

