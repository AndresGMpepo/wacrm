import crypto from 'node:crypto'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

// "Agendapro Public V1" (developers.agendapro.com/v1) — HTTP Basic Auth
// (a USER + PASSWORD pair issued per company from their "API Pública"
// settings panel), NOT the Bearer-key "Connect v3" product documented at
// the root of developers.agendapro.com, which is a different API this
// integration does NOT target (confirmed against a real tenant's own
// panel, not guessed).
const DEFAULT_API_URL = 'https://agendapro.com/api/public/v1'

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
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message)
    this.name = 'AgendaProApiError'
  }
}

async function getCredentials(accountId: string): Promise<{ user: string; password: string }> {
  const { data, error } = await admin()
    .from('agendapro_configs')
    .select('encrypted_api_user, encrypted_api_password')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  if (!data?.encrypted_api_user || !data?.encrypted_api_password) throw new Error('AgendaPro no está conectado para esta cuenta.')
  return { user: decrypt(data.encrypted_api_user), password: decrypt(data.encrypted_api_password) }
}

function basicAuthHeader(user: string, password: string) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
}

/** One USER+PASSWORD pair per NexoOmni tenant — looked up and decrypted per call. */
export async function agendaProFetch(accountId: string, path: string, init?: RequestInit) {
  const { user, password } = await getCredentials(accountId)
  let response: Response
  try {
    response = await fetch(`${apiUrl()}${path}`, {
      ...init,
      cache: 'no-store',
      signal: init?.signal ?? AbortSignal.timeout(20_000),
      headers: {
        Authorization: basicAuthHeader(user, password),
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
  const body = await response.json().catch(() => null) as unknown
  if (!response.ok) {
    // V1 returns `{}` on 400 with no structured error field — nothing more
    // specific to surface than the HTTP status itself (confirmed from the
    // documented OpenAPI examples, not guessed further).
    throw new AgendaProApiError(`No se pudo completar la solicitud a AgendaPro (HTTP ${response.status}).`, response.status, body)
  }
  return body ?? {}
}

function query(params: Record<string, string | number | boolean | string[] | number[] | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    if (Array.isArray(value)) {
      for (const item of value) search.append(`${key}[]`, String(item))
    } else {
      search.set(key, String(value))
    }
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
  connectedAt: string
}

export async function getAgendaProConfig(db: SupabaseClient, accountId: string): Promise<AgendaProConfig | null> {
  const { data, error } = await db
    .from('agendapro_configs')
    .select('status, last_error, webhook_token, created_at')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    status: data.status,
    lastError: data.last_error,
    webhookToken: data.webhook_token,
    connectedAt: data.created_at,
  }
}

// ------------------------------------------------------------
// Confirmation settings (24h-before WhatsApp reminder, see migration 134
// and src/lib/agendapro/confirmation.ts) — independent of the
// connect/disconnect credentials above.
// ------------------------------------------------------------

export type AgendaProConfirmationSettings = {
  enabled: boolean
  receptionPhone: string | null
  confirmationTemplateName: string
  confirmationTemplateLanguage: string
  receptionTemplateName: string
  receptionTemplateLanguage: string
}

export async function getAgendaProConfirmationSettings(db: SupabaseClient, accountId: string): Promise<AgendaProConfirmationSettings | null> {
  const { data, error } = await db
    .from('agendapro_configs')
    .select('confirmation_reminder_enabled, reception_phone, confirmation_template_name, confirmation_template_language, reception_template_name, reception_template_language')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    enabled: data.confirmation_reminder_enabled,
    receptionPhone: data.reception_phone,
    confirmationTemplateName: data.confirmation_template_name,
    confirmationTemplateLanguage: data.confirmation_template_language,
    receptionTemplateName: data.reception_template_name,
    receptionTemplateLanguage: data.reception_template_language,
  }
}

/** Requires AgendaPro to already be connected (the row this upserts into
 *  is created by saveAgendaProConfig). Template names are free text —
 *  intentionally not validated against Meta here; they only get checked
 *  for real the first time a reminder tries to send, at which point a
 *  wrong/unapproved name surfaces as a failed confirmation_reminder_status
 *  with Meta's own error message logged (see processAgendaProConfirmationReminders). */
export async function saveAgendaProConfirmationSettings(accountId: string, settings: {
  enabled: boolean
  receptionPhone: string | null
  confirmationTemplateName: string
  confirmationTemplateLanguage: string
  receptionTemplateName: string
  receptionTemplateLanguage: string
}) {
  const db = admin()
  const { error } = await db.from('agendapro_configs').update({
    confirmation_reminder_enabled: settings.enabled,
    reception_phone: settings.receptionPhone,
    confirmation_template_name: settings.confirmationTemplateName,
    confirmation_template_language: settings.confirmationTemplateLanguage,
    reception_template_name: settings.receptionTemplateName,
    reception_template_language: settings.receptionTemplateLanguage,
    updated_at: new Date().toISOString(),
  }).eq('account_id', accountId)
  if (error) throw error
}

// ------------------------------------------------------------
// Calendar status colors (migration 135) — see
// src/lib/agendapro/status-colors.ts for the deterministic-default +
// override scheme this backs.
// ------------------------------------------------------------

export async function getAgendaProStatusColors(db: SupabaseClient, accountId: string): Promise<Record<string, string>> {
  const { data, error } = await db
    .from('agendapro_configs')
    .select('status_colors')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  return (data?.status_colors as Record<string, string> | null) ?? {}
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i

export async function saveAgendaProStatusColors(accountId: string, colors: Record<string, string>) {
  for (const [key, value] of Object.entries(colors)) {
    if (!key.trim() || !HEX_COLOR_RE.test(value)) {
      throw new Error(`Color inválido para "${key}" — usa un hexadecimal como #10b981.`)
    }
  }
  const db = admin()
  const { error } = await db.from('agendapro_configs').update({
    status_colors: colors,
    updated_at: new Date().toISOString(),
  }).eq('account_id', accountId)
  if (error) throw error
}

/** Validates the credentials against AgendaPro (a cheap `GET /locations` call) before persisting them. */
export async function saveAgendaProConfig(accountId: string, apiUser: string, apiPassword: string, userId: string) {
  const db = admin()
  const trimmedUser = apiUser.trim()
  const trimmedPassword = apiPassword.trim()
  if (!trimmedUser || !trimmedPassword) throw new Error('Ingresa el usuario y la contraseña de la API de AgendaPro.')

  const probe = await fetch(`${apiUrl()}/locations`, {
    headers: { Authorization: basicAuthHeader(trimmedUser, trimmedPassword), Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  if (!probe || !probe.ok) {
    throw new Error('No se pudo validar el usuario y la contraseña de AgendaPro. Verifica las credenciales de "Configuraciones → API Pública" y que el plan las tenga habilitadas.')
  }

  const { data: existing } = await db.from('agendapro_configs').select('webhook_token').eq('account_id', accountId).maybeSingle()
  const webhookToken = existing?.webhook_token || crypto.randomBytes(24).toString('hex')

  const { error } = await db.from('agendapro_configs').upsert({
    account_id: accountId,
    encrypted_api_user: encrypt(trimmedUser),
    encrypted_api_password: encrypt(trimmedPassword),
    webhook_token: webhookToken,
    status: 'active',
    last_error: null,
    connected_by: userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'account_id' })
  if (error) throw error
  return webhookToken
}

export async function disconnectAgendaPro(accountId: string) {
  const { error } = await admin().from('agendapro_configs').delete().eq('account_id', accountId)
  if (error) throw error
}

// ------------------------------------------------------------
// Bookings ("Reservas")
// ------------------------------------------------------------

export async function listAgendaProBookings(accountId: string, params: {
  range_from?: string; range_to?: string; created_from?: string; created_to?: string
  updated_from?: string; updated_to?: string
  statuses?: number[]; services?: number[]; providers?: number[]; locations?: number[]; clients?: number[]
  page?: number
}) {
  return agendaProFetch(accountId, `/bookings${query(params)}`)
}

export async function createAgendaProBooking(accountId: string, body: {
  start: string; end: string; service_id: number; provider_id: number; price?: number
  first_name: string; last_name?: string; email?: string; phone?: string; identification_number?: string
}) {
  return agendaProFetch(accountId, '/bookings', { method: 'POST', body: JSON.stringify(body) })
}

export async function getAgendaProBooking(accountId: string, bookingId: number) {
  return agendaProFetch(accountId, `/bookings/${bookingId}`)
}

/** `PATCH /bookings/{id}` — confirmed from
 *  developers.agendapro.com/v1.0/reference/editar-una-reserva. Only
 *  `start`, `end`, `provider_id`, and `status_id` are documented as
 *  editable; `status_id` explicitly excludes "cancelado" (that's a
 *  separate, undocumented-here endpoint this integration does not
 *  implement) — enforced by only ever sending one of the six ids in
 *  AGENDAPRO_STATUS_OPTIONS (see status-colors.ts). AgendaPro itself
 *  may still reject the edit with a 422 if the merchant's own booking
 *  policy restricts it (e.g. too close to start time).
 */
export async function updateAgendaProBooking(accountId: string, bookingId: number, body: {
  start?: string; end?: string; provider_id?: number; status_id?: number
}) {
  return agendaProFetch(accountId, `/bookings/${bookingId}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export async function listAvailableHours(accountId: string, serviceId: number, params: {
  date: string; provider_id?: number; location_id?: number
}) {
  return agendaProFetch(accountId, `/services/${serviceId}/available_hours${query(params)}`)
}

// ------------------------------------------------------------
// Clients ("Clientes")
// ------------------------------------------------------------

export async function listAgendaProClients(accountId: string) {
  return agendaProFetch(accountId, '/clients')
}

export async function createAgendaProClient(accountId: string, body: {
  first_name: string; last_name?: string; email?: string; phone?: string; identification_number?: string
}) {
  return agendaProFetch(accountId, '/clients', { method: 'POST', body: JSON.stringify(body) })
}

// ------------------------------------------------------------
// Catalog (locations/services/providers) — fetch-through, no local cache
// ------------------------------------------------------------

export async function listAgendaProLocations(accountId: string) {
  return agendaProFetch(accountId, '/locations')
}

export async function listAgendaProServices(accountId: string) {
  return agendaProFetch(accountId, '/services')
}

export async function listAgendaProProviders(accountId: string) {
  return agendaProFetch(accountId, '/service_providers')
}

// ------------------------------------------------------------
// Payments ("Pagos") — V1 records an ALREADY-COLLECTED payment (cash/card/
// etc. via `transactions`); unlike Connect v3 there is no "payment
// request"/checkout-URL concept confirmed in this API, so there is no
// "send a payment link via WhatsApp" capability here.
// ------------------------------------------------------------

export async function listAgendaProPayments(accountId: string) {
  return agendaProFetch(accountId, '/payments')
}

/** Body shape is intentionally a generic passthrough (transactions[]/receipts[].items[]) —
 *  see docs.agendapro.com's "Crear Pagos" reference for the full item-type union
 *  (service/product/giftcard/other) before building a UI on top of this. */
export async function createAgendaProPayment(accountId: string, body: Record<string, unknown>) {
  return agendaProFetch(accountId, '/payments', { method: 'POST', body: JSON.stringify(body) })
}

