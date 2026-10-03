// ============================================================
// Status → color for the AgendaPro calendar.
//
// AgendaPro's "Agendapro Public V1" (the product this integration
// targets — see src/lib/agendapro/server.ts) documents a fixed
// status_id enum for a booking's editable (non-cancelled) states —
// confirmed from developers.agendapro.com/v1.0/reference/editar-una-reserva:
//   1 Reservado · 2 Confirmado · 3 Asiste · 6 No Asiste · 7 En Espera · 8 Pendiente
// DEFAULT_STATUS_COLORS below matches this account's own real color
// code (confirmed with the client, not guessed): azul=Reservado,
// amarillo=Confirmado, rosa=Asiste, verde=En Espera, rojo=Pendiente
// (repurposed in-house for "cita especial" — domicilio/paciente que se
// agenda solo/masaje — same status_id, just their own business
// meaning), rojo claro=No Asiste.
//
// Any status this tenant's AgendaPro returns that ISN'T one of these
// six (a custom status added in their AgendaPro panel, for instance)
// still gets a *stable* default color derived from its own text, and
// any status — known or not — can be overridden from Settings →
// AgendaPro → "Colores por estado" to match their real AgendaPro
// exactly.
// ============================================================

/** The only non-cancelled status_id values PATCH /bookings/{id} accepts
 *  (cancelling is DELETE /bookings/{id} — see cancelAgendaProBooking in
 *  server.ts). */
export const AGENDAPRO_STATUS_OPTIONS = [
  { id: 1, label: 'Reservado', color: '#3b82f6' },
  { id: 2, label: 'Confirmado', color: '#eab308' },
  { id: 3, label: 'Asiste', color: '#ec4899' },
  { id: 7, label: 'En Espera', color: '#22c55e' },
  { id: 8, label: 'Pendiente', color: '#ef4444' },
  { id: 6, label: 'No Asiste', color: '#fca5a5' },
] as const;

/** Keyed by the same normalized text colorForStatus looks up — built
 *  from AGENDAPRO_STATUS_OPTIONS so the two can never drift apart. */
const DEFAULT_STATUS_COLORS: Record<string, string> = Object.fromEntries(
  AGENDAPRO_STATUS_OPTIONS.map((option) => [option.label.toLowerCase(), option.color]),
)

/** Ten visually distinct, accessible swatches — shown as the palette
 *  in the status-colors picker and used for the deterministic default
 *  fallback for a status outside the known six above. */
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
 *  own override first, then the known default for AgendaPro's six
 *  documented statuses, then a stable deterministic fallback for
 *  anything else (e.g. a custom status added in their AgendaPro panel). */
export function colorForStatus(status: string | null | undefined, overrides: Record<string, string>): string {
  const key = normalizeStatusKey(status || 'sin estado');
  if (overrides[key]) return overrides[key];
  if (DEFAULT_STATUS_COLORS[key]) return DEFAULT_STATUS_COLORS[key];
  return STATUS_COLOR_PALETTE[hashString(key) % STATUS_COLOR_PALETTE.length];
}

/** Normalizes a raw status string into the same key used as the
 *  overrides map's key — so the Settings UI and the calendar always
 *  agree on what counts as "the same status". */
export { normalizeStatusKey };
