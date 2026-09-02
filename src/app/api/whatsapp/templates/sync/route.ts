import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { listZernioWhatsAppTemplates } from '@/lib/zernio/server'
import {
  metaTemplateToRow,
  type MetaTemplate,
} from '@/lib/whatsapp/template-meta-sync'

/**
 * Sync message templates from Meta → local message_templates table.
 *
 * Two sources are synced in one call: the native (direct Meta Cloud API)
 * connection in `whatsapp_config`, plus every active Zernio-connected
 * WhatsApp number (`omnichannel_connectors.provider = 'zernio_whatsapp'`) —
 * Zernio proxies the same Meta template API, so the parsing is shared
 * (see template-meta-sync.ts). Each source's rows are scoped by
 * `connector_id` (NULL = native) so two connections never collide on
 * the same template name/language.
 *
 * The local catalog stores Meta's status enum verbatim (APPROVED /
 * PENDING / REJECTED / PAUSED / DISABLED / IN_APPEAL / PENDING_DELETION)
 * so the edit / resubmit / delete flows can distinguish recoverable
 * states (PAUSED) from terminal ones (DISABLED) and so webhook events
 * land 1:1 without a translation table.
 *
 * Locally-created templates (no Meta counterpart) are NOT deleted —
 * they remain visible so the user can notice drift and clean up.
 */

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

type SyncResult = { inserted: number; updated: number; errors: { name: string; language: string; message: string }[] }

async function upsertTemplateRows(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  connectorId: string | null,
  metaTemplates: MetaTemplate[],
): Promise<SyncResult> {
  let inserted = 0
  let updated = 0
  const errors: SyncResult['errors'] = []

  for (const t of metaTemplates) {
    const row = metaTemplateToRow(t, { account_id: accountId, user_id: userId, connector_id: connectorId })

    let existingQuery = supabase
      .from('message_templates')
      .select('id')
      .eq('account_id', accountId)
      .eq('name', t.name)
      .eq('language', t.language)
    existingQuery = connectorId ? existingQuery.eq('connector_id', connectorId) : existingQuery.is('connector_id', null)
    const { data: existing, error: lookupErr } = await existingQuery.maybeSingle()

    if (lookupErr) {
      errors.push({ name: t.name, language: t.language, message: lookupErr.message })
      continue
    }

    if (existing?.id) {
      const { error: updErr } = await supabase.from('message_templates').update(row).eq('id', existing.id)
      if (updErr) errors.push({ name: t.name, language: t.language, message: updErr.message })
      else updated++
    } else {
      const { error: insErr } = await supabase.from('message_templates').insert(row)
      if (insErr) errors.push({ name: t.name, language: t.language, message: insErr.message })
      else inserted++
    }
  }

  return { inserted, updated, errors }
}

async function fetchNativeMetaTemplates(wabaId: string, accessToken: string): Promise<{ templates: MetaTemplate[]; truncated: boolean; error?: string }> {
  const templates: MetaTemplate[] = []
  let nextUrl: string | null = `${META_API_BASE}/${wabaId}/message_templates?limit=100&fields=id,name,language,status,category,components,quality_score`
  const PAGE_CAP = 20
  let pageCount = 0

  while (nextUrl && pageCount < PAGE_CAP) {
    pageCount++
    const metaRes: Response = await fetch(nextUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!metaRes.ok) {
      let metaErr = `Meta API error: ${metaRes.status}`
      try {
        const body = await metaRes.json()
        if (body?.error?.message) metaErr = body.error.message
      } catch {
        // response wasn't JSON — keep the fallback
      }
      return { templates, truncated: false, error: metaErr }
    }
    const metaBody: { data?: MetaTemplate[]; paging?: { next?: string } } = await metaRes.json()
    if (metaBody.data) templates.push(...metaBody.data)
    nextUrl = metaBody.paging?.next ?? null
  }

  return { templates, truncated: pageCount >= PAGE_CAP && nextUrl !== null }
}

export async function POST() {
  try {
    // Syncing rewrites the account-wide template catalog, which is
    // settings-class data: `canEditSettings` and the message_templates
    // insert/update RLS policies (migration 017) both require 'admin'.
    // Resolving account_id off the profile only proved membership.
    const { supabase, accountId, userId } = await requireRole('admin')

    let total = 0
    let inserted = 0
    let updated = 0
    let truncated = false
    const errors: { name: string; language: string; message: string }[] = []
    const sourceErrors: string[] = []

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle()

    if (config?.waba_id) {
      const accessToken = decrypt(config.access_token)
      const { templates, truncated: nativeTruncated, error } = await fetchNativeMetaTemplates(config.waba_id, accessToken)
      if (error) {
        sourceErrors.push(`WhatsApp directo: ${error}`)
      } else {
        total += templates.length
        truncated = truncated || nativeTruncated
        const result = await upsertTemplateRows(supabase, accountId, userId, null, templates)
        inserted += result.inserted
        updated += result.updated
        errors.push(...result.errors)
      }
    }

    const { data: zernioConnectors } = await supabase
      .from('omnichannel_connectors')
      .select('id, display_name, zernio_account_id')
      .eq('account_id', accountId)
      .eq('provider', 'zernio_whatsapp')
      .neq('status', 'paused')
      .not('zernio_account_id', 'is', null)

    for (const connector of zernioConnectors ?? []) {
      if (!connector.zernio_account_id) continue
      try {
        const templates = await listZernioWhatsAppTemplates(connector.zernio_account_id)
        total += templates.length
        const result = await upsertTemplateRows(supabase, accountId, userId, connector.id, templates as MetaTemplate[])
        inserted += result.inserted
        updated += result.updated
        errors.push(...result.errors)
      } catch (error) {
        sourceErrors.push(`${connector.display_name}: ${error instanceof Error ? error.message : 'Error desconocido'}`)
      }
    }

    if (!config?.waba_id && !zernioConnectors?.length) {
      return NextResponse.json(
        {
          error:
            'No hay ningún WhatsApp conectado (ni directo ni vía Zernio). Conecta uno en Configuración antes de sincronizar.',
        },
        { status: 400 },
      )
    }

    return NextResponse.json({
      success: errors.length === 0 && sourceErrors.length === 0,
      total,
      inserted,
      updated,
      errors,
      source_errors: sourceErrors,
      truncated,
    })
  } catch (error) {
    // Auth failures map to 401/403 rather than being folded into the
    // generic 500 below, which surfaces `error.message` as a sync failure.
    if (
      error instanceof UnauthorizedError ||
      error instanceof ForbiddenError
    ) {
      return toErrorResponse(error)
    }
    console.error('Error syncing WhatsApp templates:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to sync templates',
      },
      { status: 500 },
    )
  }
}
