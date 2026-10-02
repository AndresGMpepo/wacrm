import { NextResponse } from 'next/server'

import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'
import { getAgendaProConfirmationSettings, saveAgendaProConfirmationSettings } from '@/lib/agendapro/server'
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'

/**
 * 24h-before WhatsApp confirmation settings for AgendaPro bookings.
 * Independent of /api/agendapro/config (connect/disconnect credentials) —
 * see supabase/migrations/134_agendapro_appointment_confirmations.sql and
 * docs/manuals/integraciones/agendapro.md for the full flow and the Meta
 * template names this depends on.
 */

export async function GET() {
  try {
    const { supabase, accountId } = await requireAccountModule('agendapro', 'admin')
    const settings = await getAgendaProConfirmationSettings(supabase, accountId)
    if (!settings) return NextResponse.json({ error: 'Conecta AgendaPro antes de configurar las confirmaciones.' }, { status: 404 })
    return NextResponse.json(settings)
  } catch (error) { return toErrorResponse(error) }
}

export async function POST(request: Request) {
  try {
    const { accountId } = await requireAccountModule('agendapro', 'admin')
    const body = await request.json().catch(() => null) as {
      enabled?: unknown
      reception_phone?: unknown
      confirmation_template_name?: unknown
      confirmation_template_language?: unknown
      reception_template_name?: unknown
      reception_template_language?: unknown
    } | null

    const receptionPhoneRaw = typeof body?.reception_phone === 'string' ? body.reception_phone.trim() : ''
    let receptionPhone: string | null = null
    if (receptionPhoneRaw) {
      const sanitized = sanitizePhoneForMeta(receptionPhoneRaw)
      if (!isValidE164(sanitized)) {
        return NextResponse.json({ error: 'El teléfono de recepción debe ser un número válido en formato internacional, ej. +52 55 1234 5678.' }, { status: 400 })
      }
      receptionPhone = sanitized
    }

    const confirmationTemplateName = typeof body?.confirmation_template_name === 'string' ? body.confirmation_template_name.trim() : ''
    const receptionTemplateName = typeof body?.reception_template_name === 'string' ? body.reception_template_name.trim() : ''
    if (!confirmationTemplateName || !receptionTemplateName) {
      return NextResponse.json({ error: 'Faltan los nombres de las plantillas de confirmación.' }, { status: 400 })
    }

    await saveAgendaProConfirmationSettings(accountId, {
      enabled: Boolean(body?.enabled),
      receptionPhone,
      confirmationTemplateName,
      confirmationTemplateLanguage: typeof body?.confirmation_template_language === 'string' && body.confirmation_template_language.trim() ? body.confirmation_template_language.trim() : 'es_MX',
      receptionTemplateName,
      receptionTemplateLanguage: typeof body?.reception_template_language === 'string' && body.reception_template_language.trim() ? body.reception_template_language.trim() : 'es_MX',
    })
    return NextResponse.json({ ok: true })
  } catch (error) { return toErrorResponse(error) }
}
