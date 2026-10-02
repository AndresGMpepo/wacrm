// ============================================================
// Status → color for the AgendaPro calendar.
//
// AgendaPro's own `status_name` values are plain text with no
// documented, fixed set (confirmed from src/lib/agendapro/server.ts —
// only `status_id`/`status_name` as opaque fields, no enum ever
// confirmed from AgendaPro's docs). Rather than guess specific
// strings and risk silently mismatching a tenant's real AgendaPro
// setup, every status gets a *stable* default color derived from its
// own text (same status always renders the same color, even
// unconfigured) — and an account can override any specific status to
// match their real AgendaPro exactly from Settings → AgendaPro →
// "Colores por estado" once they've checked it.
// ============================================================

/** Ten visually distinct, accessible swatches — shown as the palette
 *  in the status-colors picker and used for the deterministic default. */
export const STATUS_COLOR_PALETTE = [
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#64748b', // slate
  '#84cc16', // lime
] as const;

function normalizeStatusKey(status: string): string {
  return status
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

/** Simple, stable string hash (djb2) — same input always maps to the same palette index. */
function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return Math.abs(hash);
}

/** The color to render for a given AgendaPro status_name: the account's
 *  own override if one is saved, otherwise a stable deterministic default. */
export function colorForStatus(status: string | null | undefined, overrides: Record<string, string>): string {
  const key = normalizeStatusKey(status || 'sin estado');
  if (overrides[key]) return overrides[key];
  return STATUS_COLOR_PALETTE[hashString(key) % STATUS_COLOR_PALETTE.length];
}

/** Normalizes a raw status string into the same key used as the
 *  overrides map's key — so the Settings UI and the calendar always
 *  agree on what counts as "the same status". */
export { normalizeStatusKey };
