import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { submitMessageTemplate } from '@/lib/whatsapp/meta-api'
import {
  validateTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators'
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components'
import { ensureImageHeaderHandle } from '@/lib/whatsapp/template-header-handle'
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize'
import { createZernioWhatsAppTemplate } from '@/lib/zernio/server'

/**
 * Shared upsert payload builder — both the Meta-failure path and the
 * Meta-success path write nearly identical rows; dropping the shared
 * fields here means adding a column later only touches one spot.
 */
function buildUpsertRow(
  accountId: string,
  userId: string,
  connectorId: string | null,
  payload: TemplatePayload,
  extras: {
    status: 'DRAFT' | string
    metaTemplateId: string | null
    submissionError: string | null
  },
) {
  return {
    // Account tenancy — required NOT NULL on message_templates as
    // of migration 017. Without this an INSERT throws on the
    // not-null constraint.
    account_id: accountId,
    user_id: userId,
    // NULL = the native (direct Meta) connection; otherwise the
    // specific Zernio-connected WhatsApp number this template belongs to.
    connector_id: connectorId,
    name: payload.name,
    category: payload.category,
    language: payload.language,
    header_type: payload.header_type ?? null,
    header_content: payload.header_content ?? null,
    header_media_url: payload.header_media_url ?? null,
    header_handle: payload.header_handle ?? null,
    body_text: payload.body_text,
    footer_text: payload.footer_text ?? null,
    buttons: payload.buttons ?? null,
    sample_values: payload.sample_values ?? null,
    status: extras.status,
    meta_template_id: extras.metaTemplateId,
    submission_error: extras.submissionError,
    // Clear stale rejection_reason whenever we re-submit; the
    // webhook will set it again if Meta still rejects.
    rejection_reason: extras.submissionError ? null : null,
    last_submitted_at: new Date().toISOString(),
  }
}

/**
 * The unique index moved from a plain (user_id, name, language) column
 * list to an expression index keyed on account_id + COALESCE(connector_id,
 * sentinel) + name + language (migration 104) so native and per-Zernio-
 * number templates can share a name without colliding. PostgREST's
 * `.upsert(..., { onConflict })` only targets plain column lists, not
 * expression indexes, so this does an explicit lookup-then-write instead.
 */
async function upsertTemplateRow(
  supabase: SupabaseClient,
  accountId: string,
  connectorId: string | null,
  row: ReturnType<typeof buildUpsertRow>,
) {
  let existingQuery = supabase
    .from('message_templates')
    .select('id')
    .eq('account_id', accountId)
    .eq('name', row.name)
    .eq('language', row.language)
  existingQuery = connectorId ? existingQuery.eq('connector_id', connectorId) : existingQuery.is('connector_id', null)
  const { data: existing } = await existingQuery.maybeSingle()

  if (existing?.id) {
    return supabase.from('message_templates').update(row).eq('id', existing.id).select().single()
  }
  return supabase.from('message_templates').insert(row).select().single()
}

/**
 * Submit a template to Meta for approval AND persist it locally.
 *
 * Auth → fetch whatsapp_config → validate → (DRY_RUN short-circuit) →
 * POST to Meta → upsert local row by (user_id, name, language) with
 * status, meta_template_id, sample_values, last_submitted_at.
 *
 * When WHATSAPP_TEMPLATES_DRY_RUN=true, we skip the network call and
 * insert a row with a synthetic `dry-run-<uuid>` meta_template_id so
 * CI / local dev can exercise the full UI without a real Meta App.
 *
 * On the Meta side this is a one-way trip — a row can only be
 * submitted; editing or deleting requires hsm_id and lives in PR 4.
 */
export async function POST(request: Request) {
  try {
    // Message templates are settings-class data: `canEditSettings` and the
    // message_templates_insert/update RLS policies (migration 017) both
    // require 'admin'. Resolving account_id off the profile only proved
    // membership, so a viewer or agent could push a template to Meta for
    // approval — an external side effect RLS can't roll back — before the
    // local upsert was refused.
    const { supabase, accountId, userId } = await requireRole('admin')

    let payload: TemplatePayload
    try {
      payload = (await request.json()) as TemplatePayload
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    if (payload.category === 'Authentication') {
      return NextResponse.json(
        {
          error:
            'AUTHENTICATION templates are not yet supported here — create them in Meta WhatsApp Manager and use "Sync from Meta".',
        },
        { status: 400 },
      )
    }

    try {
      validateTemplatePayload(payload)
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Validation failed.' },
        { status: 400 },
      )
    }

    const connectorId = payload.connector_id?.trim() || null

    const dryRun =
      process.env.WHATSAPP_TEMPLATES_DRY_RUN === 'true' ||
      process.env.WHATSAPP_TEMPLATES_DRY_RUN === '1'

    let metaTemplateId: string
    let metaStatus: string

    if (dryRun) {
      metaTemplateId = `dry-run-${crypto.randomUUID()}`
      metaStatus = 'PENDING'
    } else if (connectorId) {
      // Zernio-connected WhatsApp number — proxies Meta's own template
      // API, so the same components builder applies. Resumable-upload
      // image headers (ensureImageHeaderHandle below) are Meta-Graph-
      // specific and not wired up for this path yet.
      if (payload.header_type === 'image' || payload.header_type === 'video' || payload.header_type === 'document') {
        return NextResponse.json(
          { error: 'Los encabezados con imagen/video/documento aún no están soportados al crear plantillas vía Zernio. Usa un encabezado de texto o sin encabezado.' },
          { status: 400 },
        )
      }
      const { data: connector, error: connectorError } = await supabase
        .from('omnichannel_connectors')
        .select('zernio_account_id, status')
        .eq('id', connectorId)
        .eq('account_id', accountId)
        .eq('provider', 'zernio_whatsapp')
        .maybeSingle()
      if (connectorError || !connector?.zernio_account_id) {
        return NextResponse.json({ error: 'No se encontró esa conexión de WhatsApp vía Zernio.' }, { status: 400 })
      }
      if (connector.status === 'paused') {
        return NextResponse.json({ error: 'Esa conexión de WhatsApp está pausada.' }, { status: 409 })
      }
      const metaPayload = buildMetaTemplatePayload(payload)
      try {
        const created = await createZernioWhatsAppTemplate(connector.zernio_account_id, metaPayload)
        metaTemplateId = created.id
        metaStatus = created.status
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Zernio submit failed.'
        await upsertTemplateRow(
          supabase,
          accountId,
          connectorId,
          buildUpsertRow(accountId, userId, connectorId, payload, {
            status: 'DRAFT',
            metaTemplateId: null,
            submissionError: message,
          }),
        )
        return NextResponse.json({ error: message }, { status: 502 })
      }
    } else {
      const { data: config, error: configError } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('account_id', accountId)
        .single()
      if (configError || !config) {
        return NextResponse.json(
          {
            error:
              'WhatsApp not configured. Connect your WhatsApp Business account in Settings first.',
          },
          { status: 400 },
        )
      }
      if (!config.waba_id) {
        return NextResponse.json(
          {
            error:
              'WABA (WhatsApp Business Account) ID missing. Re-connect your account in Settings.',
          },
          { status: 400 },
        )
      }

      const accessToken = decrypt(config.access_token)

      // Image headers need a Resumable-Upload handle (Meta rejects a
      // plain URL at creation). Derive it from header_media_url before
      // building the payload. Surfaces a 400 with an actionable message
      // (missing META_APP_ID, unreachable URL, wrong type/size).
      try {
        await ensureImageHeaderHandle(payload, accessToken)
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : 'Header image upload failed.' },
          { status: 400 },
        )
      }

      const metaPayload = buildMetaTemplatePayload(payload)
      try {
        const meta = await submitMessageTemplate({
          wabaId: config.waba_id,
          accessToken,
          payload: metaPayload,
        })
        metaTemplateId = meta.id
        metaStatus = meta.status
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Meta submit failed.'
        // Persist the failure so the user can retry; row stays DRAFT
        // until they fix and re-submit.
        await upsertTemplateRow(
          supabase,
          accountId,
          connectorId,
          buildUpsertRow(accountId, userId, connectorId, payload, {
            status: 'DRAFT',
            metaTemplateId: null,
            submissionError: message,
          }),
        )
        const isRateLimit = /\b429\b/.test(message)
        return NextResponse.json(
          {
            error: isRateLimit
              ? 'Meta rate limit hit (100 template creates per hour). Try again later.'
              : message,
          },
          { status: isRateLimit ? 429 : 502 },
        )
      }
    }

    const { data: row, error: upsertErr } = await upsertTemplateRow(
      supabase,
      accountId,
      connectorId,
      buildUpsertRow(accountId, userId, connectorId, payload, {
        status: normalizeStatus(metaStatus),
        metaTemplateId,
        submissionError: null,
      }),
    )

    if (upsertErr) {
      // The submit succeeded on Meta's side but we failed to persist
      // locally. That's a data-drift state — surface the meta_template_id
      // so the user can recover via "Sync from Meta".
      return NextResponse.json(
        {
          error: `Submitted to Meta but failed to save locally: ${upsertErr.message}. Run "Sync from Meta" to recover.`,
          meta_template_id: metaTemplateId,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      template: row,
      dry_run: dryRun,
    })
  } catch (error) {
    // Auth failures map to 401/403. Handled before the generic branch
    // below, which surfaces `error.message` as a 500 — reporting "you
    // aren't an admin" as a template submission failure would send the
    // user chasing the wrong problem.
    if (
      error instanceof UnauthorizedError ||
      error instanceof ForbiddenError
    ) {
      return toErrorResponse(error)
    }
    console.error('Error submitting template:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to submit template.',
      },
      { status: 500 },
    )
  }
}
