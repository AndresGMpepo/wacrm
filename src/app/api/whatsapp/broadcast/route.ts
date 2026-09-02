import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import { sendZernioTemplateMessage } from '@/lib/zernio/server'
import { recordBroadcastMessage } from '@/lib/whatsapp/broadcast-message-log'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

interface BroadcastResult {
  phone: string
  status: 'sent' | 'failed'
  whatsapp_message_id?: string
  error?: string
}

/**
 * Two input shapes are accepted:
 *
 *   NEW (preferred — supports per-recipient variable substitution):
 *     {
 *       recipients: Array<{ phone: string; params: string[] }>,
 *       template_name, template_language
 *     }
 *
 *   LEGACY (all phones receive the same params — kept so existing
 *   callers don't break):
 *     {
 *       phone_numbers: string[],
 *       template_params: string[],
 *       template_name, template_language
 *     }
 *
 * Previous implementation only supported the legacy shape, and the
 * sending hook was forced to ship every batch with `templateParams[0]`
 * — meaning every recipient got contact-0's personalization. The new
 * shape is what actually fixes that.
 */
interface NewRecipient {
  phone: string
  /** Body variable values, one per {{N}}. Legacy field. */
  params?: string[]
  /**
   * Structured per-send values (header text variable, media URL
   * override, URL/COPY_CODE button values). When set, takes
   * precedence over `params` for the body too — see
   * sendTemplateMessage for the merge rules.
   */
  messageParams?: SendTimeParams
  /** Our contacts.id — used to mirror the send into the inbox so a
   *  later reply has context. Optional for legacy callers. */
  contactId?: string
}

/**
 * Broadcast path for a Zernio-connected WhatsApp number. Sends one
 * "Create conversation" call per recipient (see sendZernioTemplateMessage)
 * instead of Zernio's dedicated broadcast/segment API, so per-recipient
 * personalization stays literal values we already resolved — Zernio's
 * broadcast API only fills placeholders from ITS OWN contact fields
 * (variableMapping), which don't know about our contacts' data.
 */
async function sendBroadcastViaZernio(args: {
  supabase: SupabaseClient
  accountId: string
  userId: string
  connectorId: string
  recipients: NewRecipient[]
  templateName: string
  templateLanguage: string
}) {
  const { supabase, accountId, userId, connectorId, recipients, templateName, templateLanguage } = args

  const { data: connector } = await supabase
    .from('omnichannel_connectors')
    .select('zernio_account_id, status')
    .eq('id', connectorId)
    .eq('account_id', accountId)
    .eq('provider', 'zernio_whatsapp')
    .maybeSingle()
  if (!connector?.zernio_account_id) {
    return NextResponse.json({ error: 'No se encontró esa conexión de WhatsApp vía Zernio.' }, { status: 400 })
  }
  if (connector.status === 'paused') {
    return NextResponse.json({ error: 'Esa conexión de WhatsApp está pausada.' }, { status: 409 })
  }

  const { data: templateRow } = await supabase
    .from('message_templates')
    .select('status, body_text')
    .eq('account_id', accountId)
    .eq('connector_id', connectorId)
    .eq('name', templateName)
    .eq('language', templateLanguage)
    .maybeSingle()
  if (templateRow && templateRow.status !== 'APPROVED') {
    return NextResponse.json(
      { error: `Template "${templateName}" is not approved by Meta (status: ${templateRow.status}).` },
      { status: 400 },
    )
  }

  // Only body {{n}} placeholders are supported on this path for now —
  // header-text and dynamic-URL-button variables need a differently
  // ordered flat array (header, then body, then buttons) that the
  // broadcast wizard doesn't build yet.
  if (recipients.some((r) => r.messageParams?.headerText || r.messageParams?.buttonParams)) {
    return NextResponse.json(
      { error: 'Las plantillas con variables en el encabezado o en botones aún no están soportadas al enviar vía Zernio — usa solo variables en el cuerpo.' },
      { status: 400 },
    )
  }

  const results: BroadcastResult[] = []
  let sentCount = 0
  let failedCount = 0

  for (const recipient of recipients) {
    const sanitized = sanitizePhoneForMeta(recipient.phone)
    if (!isValidE164(sanitized)) {
      results.push({ phone: recipient.phone, status: 'failed', error: 'Invalid phone number format' })
      failedCount++
      continue
    }
    try {
      const result = await sendZernioTemplateMessage({
        zernioAccountId: connector.zernio_account_id,
        phone: sanitized,
        templateName,
        templateLanguage,
        templateParams: recipient.messageParams?.body ?? recipient.params ?? [],
      })
      results.push({ phone: recipient.phone, status: 'sent', whatsapp_message_id: result.messageId })
      sentCount++
      if (recipient.contactId) {
        const bodyParams = recipient.messageParams?.body ?? recipient.params ?? []
        await recordBroadcastMessage({
          db: supabase,
          accountId,
          userId,
          contactId: recipient.contactId,
          channelType: 'zernio_whatsapp',
          connectorId,
          externalSessionId: result.conversationId,
          templateName,
          whatsappMessageId: result.messageId,
          bodyText: templateRow?.body_text,
          bodyParams,
        })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error(`Failed to send Zernio broadcast to ${recipient.phone}:`, errorMessage)
      results.push({ phone: recipient.phone, status: 'failed', error: errorMessage })
      failedCount++
    }
  }

  return NextResponse.json({ success: true, total: recipients.length, sent: sentCount, failed: failedCount, results })
}

export async function POST(request: Request) {
  try {
    // Requires the 'agent' role — `canSendMessages` in lib/auth/roles is
    // explicit that running broadcasts is a write operation and that
    // viewers are read-only.
    //
    // This endpoint writes NOTHING to the database: it reads the config
    // and template, then calls Meta directly. So unlike the rest of the
    // app there was no RLS policy backstopping a missing role check —
    // resolving `account_id` straight off the profile (which only needs
    // 'viewer') was the ONLY gate, and it let a viewer blast a template
    // to arbitrary phone numbers from the account's WhatsApp number.
    // Nothing about that is recoverable after the fact, so the check has
    // to happen here.
    const { supabase, accountId, userId } = await requireRole('agent')

    // Per-user broadcast budget. Note: this limits how often a user
    // can *start* a campaign, not how many messages go out inside
    // one — the fan-out loop below runs without additional gating.
    const limit = checkRateLimit(`broadcast:${userId}`, RATE_LIMITS.broadcast)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const {
      recipients: newRecipients,
      phone_numbers,
      template_name,
      template_language,
      template_params,
      connector_id: connectorId,
    } = body

    // Normalize to a list of {phone, params} regardless of shape.
    let recipients: NewRecipient[]
    if (Array.isArray(newRecipients) && newRecipients.length > 0) {
      recipients = newRecipients
    } else if (Array.isArray(phone_numbers) && phone_numbers.length > 0) {
      const shared: string[] = Array.isArray(template_params)
        ? template_params
        : []
      recipients = phone_numbers.map((phone: string) => ({
        phone,
        params: shared,
      }))
    } else {
      return NextResponse.json(
        {
          error:
            'Provide either `recipients` (preferred) or `phone_numbers` — must be a non-empty array',
        },
        { status: 400 }
      )
    }

    if (!template_name) {
      return NextResponse.json(
        { error: 'template_name is required' },
        { status: 400 }
      )
    }

    if (connectorId) {
      return sendBroadcastViaZernio({
        supabase,
        accountId,
        userId,
        connectorId,
        recipients,
        templateName: template_name,
        templateLanguage: template_language || 'en_US',
      })
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Please set up your WhatsApp integration first.',
        },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.access_token)

    // Load the template row once so sendTemplateMessage can build
    // header + button components on each iteration. Loading inside
    // the loop would N+1 against Supabase for every recipient.
    // Guard against a malformed local row crashing every send in
    // the loop with the same opaque TypeError — fail loudly once.
    const { data: rawTemplateRow } = await supabase
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('name', template_name)
      .eq('language', template_language || 'en_US')
      .is('connector_id', null)
      .maybeSingle()
    if (rawTemplateRow && !isMessageTemplate(rawTemplateRow)) {
      return NextResponse.json(
        {
          error:
            'Template row is malformed locally — run "Sync from Meta" in Settings to repair it before broadcasting.',
        },
        { status: 500 },
      )
    }
    // The dashboard only ever lists APPROVED templates, but this endpoint
    // is also reachable directly (public API, MCP server) with any
    // template name — enforce the same rule here so a PENDING/REJECTED
    // template can never go out and risk the WhatsApp number's quality
    // rating with Meta.
    if (rawTemplateRow && rawTemplateRow.status !== 'APPROVED') {
      return NextResponse.json(
        { error: `Template "${template_name}" is not approved by Meta (status: ${rawTemplateRow.status}).` },
        { status: 400 },
      )
    }
    const templateRow = rawTemplateRow ?? null

    const results: BroadcastResult[] = []
    let sentCount = 0
    let failedCount = 0

    for (const recipient of recipients) {
      const sanitized = sanitizePhoneForMeta(recipient.phone)

      if (!isValidE164(sanitized)) {
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: 'Invalid phone number format',
        })
        failedCount++
        continue
      }

      // Retry with phone variants on "not in allowed list" so numbers
      // that differ only in a trunk-prefix 0 still reach recipients.
      const variants = phoneVariants(sanitized)
      let sentMessageId: string | null = null
      let lastError: string | null = null

      for (const variant of variants) {
        try {
          const result = await sendTemplateMessage({
            phoneNumberId: config.phone_number_id,
            accessToken,
            to: variant,
            templateName: template_name,
            language: template_language || 'en_US',
            template: templateRow ?? undefined,
            messageParams: recipient.messageParams,
            params: recipient.params ?? [],
          })
          sentMessageId = result.messageId
          lastError = null
          break
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error'
          if (!isRecipientNotAllowedError(errorMessage)) {
            lastError = errorMessage
            break
          }
          lastError = errorMessage
          // retry with next variant
        }
      }

      if (sentMessageId) {
        results.push({
          phone: recipient.phone,
          status: 'sent',
          whatsapp_message_id: sentMessageId,
        })
        sentCount++
        if (recipient.contactId) {
          await recordBroadcastMessage({
            db: supabase,
            accountId,
            userId,
            contactId: recipient.contactId,
            channelType: 'whatsapp',
            templateName: template_name,
            whatsappMessageId: sentMessageId,
            bodyText: templateRow?.body_text,
            bodyParams: recipient.messageParams?.body ?? recipient.params ?? [],
          })
        }
      } else {
        console.error(
          `Failed to send broadcast to ${recipient.phone}:`,
          lastError
        )
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: lastError || 'Unknown error',
        })
        failedCount++
      }
    }

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      results,
    })
  } catch (error) {
    // requireRole throws Unauthorized/Forbidden; toErrorResponse maps
    // those to 401/403 and collapses anything else to a generic 500.
    console.error('Error in WhatsApp broadcast POST:', error)
    return toErrorResponse(error)
  }
}
