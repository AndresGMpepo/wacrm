import { supabaseAdmin as aiAdmin } from '@/lib/ai/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { sanitizePhoneForMeta, isValidE164, phoneVariants, isRecipientNotAllowedError } from '@/lib/whatsapp/phone-utils'
import { engineSendTemplate } from '@/lib/automations/meta-send'
import { resolveAuditUserId } from '@/lib/api/v1/contacts'
import { isUniqueViolation } from '@/lib/contacts/dedupe'

type Db = ReturnType<typeof aiAdmin>

/**
 * 24h-before WhatsApp confirmation for AgendaPro bookings.
 *
 * Flow:
 *   1. processAgendaProConfirmationReminders (cron) sends the client a
 *      template asking them to reply SI/NO ~24h before start_time.
 *   2. handleAgendaProConfirmationReply (inbound webhook hook) reads a
 *      plain-text SI/NO from the client and updates confirmation_status.
 *      A "NO" escalates to reception immediately.
 *   3. escalateUnconfirmedAgendaProBookings (cron) escalates anything
 *      still 'pending' 6h after the reminder went out, in case the
 *      client never replies at all.
 *
 * See docs/manuals/integraciones/agendapro.md for the Meta template
 * names/content this depends on.
 */

type BookingRow = {
  id: string
  account_id: string
  contact_id: string | null
  service_name: string | null
  location_name: string | null
  start_time: string | null
}

function normalizeReply(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
}

// Diacritics are already stripped by normalizeReply, so only unaccented
// forms need listing here (e.g. "sí" normalizes to "si" before the lookup).
const YES_WORDS = new Set(['si', 'confirmo', 'confirmar', 'confirmado', 'yes'])
const NO_WORDS = new Set(['no', 'cancelar', 'cancelo', 'reagendar', 'reagendo', 'no puedo'])

function formatBookingDateTime(startTime: string) {
  const date = new Date(startTime)
  const day = new Intl.DateTimeFormat('es-MX', { dateStyle: 'full' }).format(date)
  const time = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  return { day, time }
}

async function getAgendaProSettings(db: Db, accountId: string) {
  const { data } = await db
    .from('agendapro_configs')
    .select('confirmation_reminder_enabled, reception_phone, confirmation_template_name, confirmation_template_language, reception_template_name, reception_template_language')
    .eq('account_id', accountId)
    .maybeSingle()
  return data
}

/** Finds (or creates) the WhatsApp conversation used to log the
 *  confirmation reminder in the inbox, mirroring findOrCreateConversation
 *  in src/app/api/whatsapp/webhook/route.ts — duplicated rather than
 *  imported because that function is private to the webhook route. */
async function findOrCreateWhatsAppConversation(db: Db, accountId: string, contactId: string, ownerUserId: string) {
  const { data: existing } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel_type', 'whatsapp')
    .order('created_at', { ascending: true })
    .limit(1)
  if (existing && existing.length > 0) return existing[0].id as string

  const { data: created, error } = await db
    .from('conversations')
    .insert({ account_id: accountId, user_id: ownerUserId, contact_id: contactId, channel_type: 'whatsapp' })
    .select('id')
    .single()
  if (error) {
    if (isUniqueViolation(error)) {
      const { data: raced } = await db
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .eq('channel_type', 'whatsapp')
        .order('created_at', { ascending: true })
        .limit(1)
      if (raced && raced.length > 0) return raced[0].id as string
    }
    throw error
  }
  return created.id as string
}

/** Cron step: send the 24h-before confirmation template for every
 *  booking whose due_at has arrived. Mirrors processAppointmentReminders
 *  in the ai-analysis-worker route (claim-then-process, small batch). */
export async function processAgendaProConfirmationReminders(db: Db) {
  const { data, error } = await db
    .from('agendapro_bookings')
    .select('id, account_id, contact_id, service_name, location_name, start_time')
    .eq('confirmation_reminder_status', 'queued')
    .lte('confirmation_reminder_due_at', new Date().toISOString())
    .order('confirmation_reminder_due_at')
    .limit(20)
  if (error) {
    console.error('[agendapro] could not load confirmation reminders:', error.message)
    return { sent: 0, skipped: 0, failed: 1 }
  }

  let sent = 0, skipped = 0, failed = 0
  for (const booking of (data ?? []) as BookingRow[]) {
    const { data: claimed } = await db
      .from('agendapro_bookings')
      .update({ confirmation_reminder_status: 'sending' })
      .eq('id', booking.id)
      .eq('confirmation_reminder_status', 'queued')
      .select('id')
      .maybeSingle()
    if (!claimed) continue

    const skip = async (reason: string) => {
      await db.from('agendapro_bookings').update({ confirmation_reminder_status: 'skipped' }).eq('id', booking.id)
      console.warn('[agendapro] confirmation reminder skipped:', { bookingId: booking.id, reason })
      skipped++
    }

    if (!booking.start_time || new Date(booking.start_time).getTime() <= Date.now()) {
      await skip('la cita ya pasó')
      continue
    }
    if (!booking.contact_id) {
      await skip('la reserva no tiene un contacto vinculado')
      continue
    }
    const settings = await getAgendaProSettings(db, booking.account_id)
    if (!settings?.confirmation_reminder_enabled) {
      await skip('la confirmación automática no está activada para esta cuenta')
      continue
    }

    const { data: contact } = await db.from('contacts').select('id, name, phone').eq('id', booking.contact_id).maybeSingle()
    if (!contact?.phone) {
      await skip('el contacto no tiene teléfono')
      continue
    }

    try {
      const ownerUserId = await resolveAuditUserId(db, booking.account_id)
      const conversationId = await findOrCreateWhatsAppConversation(db, booking.account_id, contact.id, ownerUserId)
      const { day, time } = formatBookingDateTime(booking.start_time)
      await engineSendTemplate({
        accountId: booking.account_id,
        userId: ownerUserId,
        conversationId,
        contactId: contact.id,
        templateName: settings.confirmation_template_name,
        language: settings.confirmation_template_language,
        params: [
          contact.name || 'Cliente',
          booking.service_name || 'tu cita',
          day,
          time,
          booking.location_name || '',
        ],
      })
      await db.from('agendapro_bookings').update({
        confirmation_reminder_status: 'sent',
        confirmation_reminder_sent_at: new Date().toISOString(),
      }).eq('id', booking.id)
      sent++
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.slice(0, 500) : 'No se pudo enviar el recordatorio.'
      await db.from('agendapro_bookings').update({ confirmation_reminder_status: 'failed' }).eq('id', booking.id)
      console.error('[agendapro] could not send confirmation reminder:', { bookingId: booking.id, error: message })
      failed++
    }
  }
  return { sent, skipped, failed }
}

/** Sends the reception/staff WhatsApp alert via an approved template —
 *  works regardless of the 24h customer-service window or whether
 *  reception_phone has ever messaged this WABA, same reasoning as any
 *  other first-touch template send. Failures are logged, never thrown:
 *  the in-app notification (always attempted) must not be skipped
 *  because WhatsApp delivery to reception failed. */
async function sendReceptionWhatsAppAlert(db: Db, accountId: string, receptionPhone: string, templateName: string, language: string, params: string[]) {
  const sanitized = sanitizePhoneForMeta(receptionPhone)
  if (!isValidE164(sanitized)) {
    console.error('[agendapro] reception_phone is not a valid E.164 number:', receptionPhone)
    return
  }
  const { data: config } = await db.from('whatsapp_config').select('phone_number_id, access_token').eq('account_id', accountId).single()
  if (!config) return
  const accessToken = decrypt(config.access_token)
  for (const candidate of phoneVariants(sanitized)) {
    try {
      await sendTemplateMessage({ phoneNumberId: config.phone_number_id, accessToken, to: candidate, templateName, language, params })
      return
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (!isRecipientNotAllowedError(message)) {
        console.error('[agendapro] could not send reception WhatsApp alert:', message)
        return
      }
    }
  }
}

/** In-app notification + (optional) WhatsApp alert to reception/staff. */
async function notifyReceptionUnconfirmed(db: Db, booking: BookingRow, reason: 'declined' | 'no_response') {
  const { data: admins } = await db.from('profiles').select('user_id').eq('account_id', booking.account_id).in('account_role', ['owner', 'admin'])
  const { data: contact } = booking.contact_id
    ? await db.from('contacts').select('name, phone').eq('id', booking.contact_id).maybeSingle()
    : { data: null }
  const clientName = contact?.name || contact?.phone || 'Un cliente'
  const { day, time } = booking.start_time ? formatBookingDateTime(booking.start_time) : { day: 'fecha desconocida', time: '' }
  const reasonText = reason === 'declined' ? 'respondió que NO puede asistir' : 'no respondió al recordatorio de confirmación'
  const title = 'Cita de AgendaPro sin confirmar'
  const body = `${clientName} ${reasonText} para su cita de ${booking.service_name || 'servicio'} el ${day} a las ${time}. Contáctalo para reagendar o cancelar.`

  if (admins?.length) {
    await db.from('notifications').insert(admins.map((admin) => ({
      account_id: booking.account_id,
      user_id: admin.user_id,
      type: 'agendapro_unconfirmed_appointment' as const,
      contact_id: booking.contact_id,
      title,
      body,
    })))
  }

  const settings = await getAgendaProSettings(db, booking.account_id)
  if (settings?.reception_phone) {
    await sendReceptionWhatsAppAlert(
      db, booking.account_id, settings.reception_phone,
      settings.reception_template_name, settings.reception_template_language,
      [clientName, booking.service_name || 'servicio', day, time, reason === 'declined' ? 'El cliente canceló' : 'El cliente no respondió'],
    )
  }

  await db.from('agendapro_bookings').update({ reception_alert_sent_at: new Date().toISOString() }).eq('id', booking.id)
}

/** Cron step: escalate to reception any booking that's still 'pending'
 *  6 hours after its reminder went out (client never answered). An
 *  explicit "NO" reply escalates immediately via handleAgendaProConfirmationReply
 *  instead of waiting for this sweep. */
export async function escalateUnconfirmedAgendaProBookings(db: Db) {
  const cutoff = new Date(Date.now() - 6 * 60 * 60_000).toISOString()
  const { data, error } = await db
    .from('agendapro_bookings')
    .select('id, account_id, contact_id, service_name, location_name, start_time')
    .eq('confirmation_status', 'pending')
    .eq('confirmation_reminder_status', 'sent')
    .is('reception_alert_sent_at', null)
    .lte('confirmation_reminder_sent_at', cutoff)
    .gt('start_time', new Date().toISOString())
    .limit(20)
  if (error) {
    console.error('[agendapro] could not load unconfirmed bookings:', error.message)
    return { notified: 0 }
  }
  let notified = 0
  for (const booking of (data ?? []) as BookingRow[]) {
    const { data: claimed } = await db
      .from('agendapro_bookings')
      .update({ reception_alert_sent_at: new Date().toISOString() })
      .eq('id', booking.id)
      .is('reception_alert_sent_at', null)
      .select('id')
      .maybeSingle()
    if (!claimed) continue
    try {
      await notifyReceptionUnconfirmed(db, booking, 'no_response')
      notified++
    } catch (cause) {
      console.error('[agendapro] could not escalate unconfirmed booking:', { bookingId: booking.id, error: cause })
    }
  }
  return { notified }
}

/** Inbound webhook hook: matches a plain-text SI/NO reply against the
 *  contact's nearest upcoming booking that's awaiting confirmation. A
 *  "NO" escalates to reception right away instead of waiting for the
 *  6h sweep. No-op (not an error) when nothing matches — most inbound
 *  text has nothing to do with a pending confirmation. */
export async function handleAgendaProConfirmationReply(db: Db, accountId: string, contactId: string, text: string) {
  const normalized = normalizeReply(text)
  if (!normalized) return
  const isYes = YES_WORDS.has(normalized)
  const isNo = !isYes && NO_WORDS.has(normalized)
  if (!isYes && !isNo) return

  const { data: booking } = await db
    .from('agendapro_bookings')
    .select('id, account_id, contact_id, service_name, location_name, start_time, reception_alert_sent_at')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('confirmation_status', 'pending')
    .eq('confirmation_reminder_status', 'sent')
    .gt('start_time', new Date().toISOString())
    .order('start_time', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!booking) return

  // Conditioned on confirmation_status still being 'pending' — a claim
  // guard against the 6h escalation sweep racing this same row.
  const { data: claimed } = await db.from('agendapro_bookings').update({
    confirmation_status: isYes ? 'confirmed' : 'declined',
    confirmation_responded_at: new Date().toISOString(),
  }).eq('id', booking.id).eq('confirmation_status', 'pending').select('id').maybeSingle()
  if (!claimed) return

  if (isNo && !booking.reception_alert_sent_at) {
    await notifyReceptionUnconfirmed(db, booking as BookingRow, 'declined').catch((cause) => {
      console.error('[agendapro] could not notify reception about a declined booking:', cause)
    })
  }
}
