/**
 * Lets a NexoOmni account declare which PBX extensions belong to it when the
 * same physical Yeastar PBX is shared by several NexoOmni tenants (e.g.
 * tenant A owns extensions 1000-1120, tenant B owns 1121 and up on the same
 * PBX). Without this, a webhook event or an "Importar desde Yeastar" bulk
 * export for ANY extension on the PBX would be accepted into whichever
 * account's webhook/API credentials received it, leaking one tenant's calls
 * into another's transcription list.
 *
 * The filter is a free-form, comma-separated spec of ranges and/or single
 * extensions, e.g. "1000-1120,1200,1205-1210". An empty/missing spec means
 * "no restriction" — every extension is accepted, matching the previous
 * single-tenant-per-PBX behavior.
 */

export type ExtensionRange = [number, number]

const RANGE_TOKEN = /^(\d{1,9})\s*-\s*(\d{1,9})$/
const SINGLE_TOKEN = /^(\d{1,9})$/

function tokens(spec: string): string[] {
  return spec.split(',').map((token) => token.trim()).filter(Boolean)
}

export function parseExtensionRanges(spec: string | null | undefined): ExtensionRange[] | null {
  const trimmed = spec?.trim()
  if (!trimmed) return null
  const ranges: ExtensionRange[] = []
  for (const token of tokens(trimmed)) {
    const range = RANGE_TOKEN.exec(token)
    if (range) {
      const start = Number(range[1])
      const end = Number(range[2])
      ranges.push(start <= end ? [start, end] : [end, start])
      continue
    }
    const single = SINGLE_TOKEN.exec(token)
    if (single) {
      const value = Number(single[1])
      ranges.push([value, value])
    }
  }
  return ranges.length ? ranges : null
}

/** True when `extension` falls inside `ranges`. A null `ranges` means no
 *  restriction is configured, so everything is allowed. A configured
 *  restriction with no determinable extension is rejected — safer to skip an
 *  ambiguous call than to risk importing another tenant's. */
export function isExtensionAllowed(extension: string | null | undefined, ranges: ExtensionRange[] | null): boolean {
  if (!ranges) return true
  if (!extension) return false
  const value = Number(extension)
  if (!Number.isFinite(value)) return false
  return ranges.some(([start, end]) => value >= start && value <= end)
}

/** Returns a user-facing error message, or null when `spec` is valid (including empty). */
export function validateExtensionFilterSpec(spec: string): string | null {
  const trimmed = spec.trim()
  if (!trimmed) return null
  const parts = tokens(trimmed)
  if (!parts.length) return 'Escribe al menos un rango o extensión, por ejemplo 1000-1120.'
  for (const token of parts) {
    if (!RANGE_TOKEN.test(token) && !SINGLE_TOKEN.test(token)) {
      return `"${token}" no es válido. Usa rangos como 1000-1120 o extensiones sueltas como 1050, separados por comas.`
    }
  }
  return null
}
