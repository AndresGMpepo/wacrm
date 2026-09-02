/**
 * Shared parsing between the native (direct Meta) template sync and the
 * Zernio-connected template sync — both receive the identical Meta
 * `components` array shape (Zernio proxies Meta's template API as-is),
 * so the row-normalization logic only needs to live once.
 */
import { normalizeStatus } from './template-status-normalize'
import type { TemplateButton, TemplateSampleValues } from '@/types'

export interface MetaButton {
  type: string
  text: string
  url?: string
  phone_number?: string
  example?: string[] | string
}

export interface MetaTemplateComponent {
  type: string
  text?: string
  format?: string
  buttons?: MetaButton[]
  example?: {
    header_text?: string[]
    header_handle?: string[]
    body_text?: string[][]
  }
}

export interface MetaTemplate {
  id: string
  name: string
  language: string
  status: string
  category: string
  components?: MetaTemplateComponent[]
  quality_score?: { score?: string } | string
}

export function normalizeCategory(meta: string): 'Marketing' | 'Utility' | 'Authentication' {
  const upper = meta.toUpperCase()
  if (upper === 'UTILITY') return 'Utility'
  if (upper === 'AUTHENTICATION') return 'Authentication'
  return 'Marketing'
}

export function normalizeQualityScore(raw: MetaTemplate['quality_score']): 'GREEN' | 'YELLOW' | 'RED' | null {
  const score = typeof raw === 'string' ? raw : raw?.score ? String(raw.score) : null
  if (!score) return null
  const upper = score.toUpperCase()
  return upper === 'GREEN' || upper === 'YELLOW' || upper === 'RED' ? (upper as 'GREEN' | 'YELLOW' | 'RED') : null
}

export function parseButtons(metaButtons: MetaButton[] | undefined): TemplateButton[] {
  if (!metaButtons?.length) return []
  const out: TemplateButton[] = []
  for (const b of metaButtons) {
    switch (b.type?.toUpperCase()) {
      case 'QUICK_REPLY':
        out.push({ type: 'QUICK_REPLY', text: b.text })
        break
      case 'URL':
        out.push({ type: 'URL', text: b.text, url: b.url ?? '', example: Array.isArray(b.example) ? b.example[0] : b.example })
        break
      case 'PHONE_NUMBER':
        out.push({ type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone_number ?? '' })
        break
      case 'COPY_CODE':
        out.push({ type: 'COPY_CODE', text: b.text, example: Array.isArray(b.example) ? b.example[0] ?? '' : b.example ?? '' })
        break
      // OTP, FLOW, etc — out of scope for v1; drop silently.
    }
  }
  return out
}

export function extractSampleValues(
  body: MetaTemplateComponent | undefined,
  header: MetaTemplateComponent | undefined,
): TemplateSampleValues | null {
  // Meta returns body_text as a 2D array — one row per example set.
  // We take the first row (most templates have exactly one).
  const bodySample = body?.example?.body_text?.[0]
  const headerSample = header?.example?.header_text
  if (!bodySample?.length && !headerSample?.length) return null
  const sv: TemplateSampleValues = {}
  if (bodySample?.length) sv.body = bodySample
  if (headerSample?.length) sv.header = headerSample
  return sv
}

/** Normalizes one Meta template (native or Zernio-fetched) into a message_templates row. */
export function metaTemplateToRow(
  t: MetaTemplate,
  tenancy: { account_id: string; user_id: string; connector_id: string | null },
) {
  const body = (t.components ?? []).find((c) => c.type === 'BODY')
  const header = (t.components ?? []).find((c) => c.type === 'HEADER')
  const footer = (t.components ?? []).find((c) => c.type === 'FOOTER')
  const buttons = (t.components ?? []).find((c) => c.type === 'BUTTONS')

  const parsedButtons = parseButtons(buttons?.buttons)
  const sampleValues = extractSampleValues(body, header)

  const headerFormat = header?.format?.toUpperCase()
  const headerType =
    headerFormat === 'TEXT' || headerFormat === 'IMAGE' || headerFormat === 'VIDEO' || headerFormat === 'DOCUMENT'
      ? headerFormat.toLowerCase()
      : null

  return {
    account_id: tenancy.account_id,
    user_id: tenancy.user_id,
    connector_id: tenancy.connector_id,
    name: t.name,
    category: normalizeCategory(t.category),
    language: t.language,
    header_type: headerType,
    header_content: header?.text ?? null,
    header_handle: header?.example?.header_handle?.[0] ?? null,
    body_text: body?.text ?? '',
    footer_text: footer?.text ?? null,
    buttons: parsedButtons.length ? parsedButtons : null,
    sample_values: sampleValues,
    status: normalizeStatus(t.status),
    meta_template_id: t.id,
    quality_score: normalizeQualityScore(t.quality_score),
    updated_at: new Date().toISOString(),
  }
}
