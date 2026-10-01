import crypto from 'node:crypto'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

const DEFAULT_API_URL = 'https://connect.agendapro.com/v3'

function apiUrl() {
  return (process.env.AGENDAPRO_API_BASE_URL?.trim() || DEFAULT_API_URL).replace(/\/$/, '')
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Falta la configuración del servidor.')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

/** Carries the parsed error body so callers can inspect status-specific fields. */
export class AgendaProApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: Record<string, unknown> | null) {
    super(message)
    this.name = 'AgendaProApiError'
  }
}

async function getApiKey(accountId: string): Promise<string> {
  const { data, error } = await admin()
    .from('agendapro_configs')
    .select('encrypted_api_key')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  if (!data?.encrypted_api_key) throw new Error('AgendaPro no está conectado para esta cuenta.')
  return decrypt(data.encrypted_api_key)
}

/** One API key per NexoOmni tenant (unlike Zernio's single shared env-var key) — looked up and decrypted per call. */
export async function agendaProFetch(accountId: string, path: string, init?: RequestInit) {
  const apiKey = await getApiKey(accountId)
  let response: Response
  try {
    response = await fetch(`${apiUrl()}${path}`, {
      ...init,
      cache: 'no-store',
      signal: init?.signal ?? AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('AgendaPro no respondió a tiempo. Intenta de nuevo en unos segundos.')
    }
    throw new Error(`No se pudo contactar a AgendaPro: ${error instanceof Error ? error.message : 'error de red'}`)
  }
  const body = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail
      : typeof body?.error === 'string' ? body.error
        : `HTTP ${response.status}`
    throw new AgendaProApiError(`No se pudo completar la solicitud a AgendaPro: ${detail}`, response.status, body)
  }
  return body ?? {}
}

function query(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

// ------------------------------------------------------------
// Config (connect/disconnect/test)
// ------------------------------------------------------------

export type AgendaProConfig = {
  status: 'configured' | 'active' | 'error'
  lastError: string | null
  webhookToken: string
  hasWebhookSecret: boolean
  connectedAt: string
}

export async function getAgendaProConfig(db: SupabaseClient, accountId: string): Promise<AgendaProConfig | null> {
  const { data, error } = await db
    .from('agendapro_configs')
    .select('status, last_error, webhook_token, encrypted_webhook_secret, created_at')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    status: data.status,
    lastError: data.last_error,
    webhookToken: data.webhook_token,
    hasWebhookSecret: Boolean(data.encrypted_webhook_secret),
    connectedAt: data.created_at,
  }
}

/** Validates the key against AgendaPro (a cheap `listLocations` call) before persisting it — same "test before save" pattern as the WhatsApp config route. */
export async function saveAgendaProConfig(accountId: string, apiKey: string, userId: string) {
  const db = admin()
  const trimmedKey = apiKey.trim()
  if (!trimmedKey) throw new Error('Ingresa una API key de AgendaPro.')

  const probe = await fetch(`${apiUrl()}/locations?per_page=1`, {
    headers: { Authorization: `Bearer ${trimmedKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  if (!probe || !probe.ok) {
    throw new Error('No se pudo validar la API key de AgendaPro. Verifica que sea correcta y que el acceso a la API esté activo para la empresa.')
  }

  const { data: existing } = await db.from('agendapro_configs').select('webhook_token').eq('account_id', accountId).maybeSingle()
  const webhookToken = existing?.webhook_token || crypto.randomBytes(24).toString('hex')

  const { error } = await db.from('agendapro_configs').upsert({
    account_id: accountId,
    encrypted_api_key: encrypt(trimmedKey),
    webhook_token: webhookToken,
    status: 'active',
    last_error: null,
    connected_by: userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'account_id' })
  if (error) throw error
  return webhookToken
}

export async function saveAgendaProWebhookSecret(accountId: string, secret: string) {
  const trimmed = secret.trim()
  if (!trimmed) throw new Error('Ingresa el secreto del webhook.')
  const { error } = await admin().from('agendapro_configs')
    .update({ encrypted_webhook_secret: encrypt(trimmed), updated_at: new Date().toISOString() })
    .eq('account_id', accountId)
  if (error) throw error
}

export async function disconnectAgendaPro(accountId: string) {
  const { error } = await admin().from('agendapro_configs').delete().eq('account_id', accountId)
  if (error) throw error
}

// ------------------------------------------------------------
// Bookings
// ------------------------------------------------------------

export async function listAgendaProBookings(accountId: string, params: {
  client_id?: number; location_id?: number; service_id?: number; service_provider_id?: number
  scheduled?: boolean; status_id?: number; start_date?: string; end_date?: string; page?: number; per_page?: number
}) {
  return agendaProFetch(accountId, `/bookings${query(params)}`)
}

export async function createAgendaProBooking(accountId: string, body: {
  start_time: string; end_time?: string; service_id: number; provider_id: number; client_id: number
  location_id: number; status_id: number; price?: string; notes?: string; time_resource_id?: number
}) {
  return agendaProFetch(accountId, '/bookings', { method: 'POST', body: JSON.stringify(body) })
}

/** Caches a full Booking resource (richer than the webhook's partial payload —
 *  see the webhook route's own upsert) right after we create it ourselves,
 *  so it shows up immediately without waiting for the booking.created webhook. */
export async function cacheAgendaProBooking(db: SupabaseClient, accountId: string, contactId: string | null, booking: Record<string, unknown>) {
  const status = booking.status as Record<string, unknown> | undefined
  const service = booking.service as Record<string, unknown> | undefined
  const provider = booking.service_provider as Record<string, unknown> | undefined
  const location = booking.location as Record<string, unknown> | undefined
  const sale = booking.sale as Record<string, unknown> | undefined
  const { error } = await db.from('agendapro_bookings').upsert({
    account_id: accountId,
    contact_id: contactId,
    agendapro_booking_id: String(booking.id),
    agendapro_client_id: booking.client_id != null ? String(booking.client_id) : null,
    service_name: typeof service?.name === 'string' ? service.name : null,
    provider_name: typeof provider?.public_name === 'string' ? provider.public_name : null,
    location_id: booking.location_id != null ? String(booking.location_id) : null,
    location_name: typeof location?.name === 'string' ? location.name : null,
    start_time: typeof booking.start_time === 'string' ? booking.start_time : null,
    end_time: typeof booking.end_time === 'string' ? booking.end_time : null,
    status_id: typeof booking.status_id === 'number' ? booking.status_id : null,
    status_name: typeof status?.name === 'string' ? status.name : null,
    price: typeof booking.price === 'string' ? booking.price : null,
    sale_id: sale?.id != null ? String(sale.id) : null,
    agendapro_created_at: typeof booking.created_at === 'string' ? booking.created_at : null,
    agendapro_updated_at: typeof booking.updated_at === 'string' ? booking.updated_at : null,
    synced_at: new Date().toISOString(),
  }, { onConflict: 'account_id,agendapro_booking_id' })
  if (error) throw error
}

export async function listAvailableSlots(accountId: string, params: {
  location_id: number; start_date: string; service_id?: number; provider_id?: number
}) {
  return agendaProFetch(accountId, `/available_slots${query(params)}`)
}

// ------------------------------------------------------------
// Clients
// ------------------------------------------------------------

export async function listAgendaProClients(accountId: string, params: { page?: number; per_page?: number } = {}) {
  return agendaProFetch(accountId, `/clients${query(params)}`)
}

export async function createAgendaProClient(accountId: string, body: {
  first_name: string; last_name?: string; email?: string; phone?: string
}) {
  return agendaProFetch(accountId, '/clients', { method: 'POST', body: JSON.stringify(body) })
}

// ------------------------------------------------------------
// Catalog (locations/services/providers/products) — fetch-through, no local cache
// ------------------------------------------------------------

export async function listAgendaProLocations(accountId: string, params: { active?: boolean; page?: number; per_page?: number } = {}) {
  return agendaProFetch(accountId, `/locations${query(params)}`)
}

export async function listAgendaProServices(accountId: string, params: { provider_id?: number; page?: number; per_page?: number } = {}) {
  return agendaProFetch(accountId, `/services${query(params)}`)
}

export async function listAgendaProProviders(accountId: string, params: {
  location_ids?: string; service_ids?: string; public_name?: string; active?: boolean; page?: number; per_page?: number
} = {}) {
  return agendaProFetch(accountId, `/providers${query(params)}`)
}

export async function listAgendaProProducts(accountId: string, params: { active?: boolean; search?: string; page?: number; per_page?: number } = {}) {
  return agendaProFetch(accountId, `/products${query(params)}`)
}

// ------------------------------------------------------------
// Sales (read-only) + Carts/Payment Requests
// ------------------------------------------------------------

export async function listAgendaProSales(accountId: string, params: {
  paid_at_start?: string; paid_at_end?: string; location_id?: number; client_id?: number; page?: number; per_page?: number
} = {}) {
  return agendaProFetch(accountId, `/sales${query(params)}`)
}

/** Cart item shape isn't fully pinned down from the docs yet — kept as a generic passthrough
 *  body (not a guessed strict type) until a cart-creation UI is actually built. */
export async function createAgendaProCart(accountId: string, body: Record<string, unknown>) {
  return agendaProFetch(accountId, '/carts', { method: 'POST', body: JSON.stringify(body) })
}

export async function getAgendaProCart(accountId: string, cartId: number) {
  return agendaProFetch(accountId, `/carts/${cartId}`)
}

/** Covers the cart's full total; cancels any previous pending request on the same cart. */
export async function createAgendaProPaymentRequest(accountId: string, cartId: number) {
  return agendaProFetch(accountId, `/carts/${cartId}/payment_requests`, { method: 'POST' })
}

export async function cancelAgendaProPaymentRequest(accountId: string, paymentRequestId: number) {
  return agendaProFetch(accountId, `/payment_requests/${paymentRequestId}/cancel`, { method: 'PATCH' })
}

// ------------------------------------------------------------
// Webhook signature verification
// https://developers.agendapro.com/docs/webhooks
// ------------------------------------------------------------

const WEBHOOK_MAX_SKEW_SECONDS = 5 * 60

export function verifyAgendaProSignature(
  webhookId: string | null,
  timestamp: string | null,
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!webhookId || !timestamp || !signature) return false
  const timestampSeconds = Number(timestamp)
  if (!Number.isFinite(timestampSeconds)) return false
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > WEBHOOK_MAX_SKEW_SECONDS) return false

  const content = `${webhookId}.${timestamp}.${rawBody}`
  const expected = crypto.createHmac('sha256', secret).update(content).digest('base64')
  const received = signature.startsWith('v1,') ? signature.slice(3) : signature
  const expectedBuf = Buffer.from(expected)
  const receivedBuf = Buffer.from(received)
  if (expectedBuf.length !== receivedBuf.length) return false
  return crypto.timingSafeEqual(expectedBuf, receivedBuf)
}
