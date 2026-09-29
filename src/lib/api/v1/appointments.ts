// ============================================================
// Shared appointment logic for the public API (v1).
//
// Kept out of the route files so list/get/create/update share one
// select/serializer — same pattern as contacts.ts / deals.ts. The
// heavier orchestration (conflict detection, Google Calendar sync,
// Nexo Memory events) stays in the existing shared libs
// (src/lib/appointments/{availability,google-calendar,memory}.ts) —
// this file does NOT reimplement any of that, it only calls it, so
// the public API and the dashboard can never silently diverge on
// double-booking or sync behavior.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export const APPOINTMENT_SELECT =
  'id, contact_id, assigned_agent_id, specialist_id, title, notes, starts_at, ends_at, timezone, status, ' +
  'google_calendar_event_id, google_calendar_connection_id, google_sync_status, google_sync_error, ' +
  'created_at, updated_at, contact:contacts(id,name,phone)';

export interface ApiAppointment {
  id: string;
  contact_id: string | null;
  assigned_agent_id: string | null;
  specialist_id: string | null;
  title: string;
  notes: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  google_calendar_event_id: string | null;
  google_calendar_connection_id: string | null;
  google_sync_status: string | null;
  google_sync_error: string | null;
  created_at: string;
  updated_at: string;
  contact: { id: string; name: string | null; phone: string | null } | null;
}

export async function getAppointmentById(
  db: SupabaseClient,
  accountId: string,
  appointmentId: string
): Promise<ApiAppointment | null> {
  const { data, error } = await db
    .from('appointments')
    .select(APPOINTMENT_SELECT)
    .eq('id', appointmentId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as ApiAppointment;
}

/** A chosen calendar must belong to this account and match the appointment's
 *  own scope (a specific specialist, or the general/no-specialist scope) —
 *  otherwise a doctor's private calendar could be picked for someone else's
 *  appointment. Mirrors the dashboard route's own `validGoogleConnectionId`. */
export async function validGoogleConnectionId(
  db: SupabaseClient,
  accountId: string,
  connectionId: string,
  scopeSpecialistId: string | null
): Promise<boolean> {
  let query = db
    .from('google_calendar_connections')
    .select('id')
    .eq('id', connectionId)
    .eq('account_id', accountId);
  query = scopeSpecialistId ? query.eq('specialist_id', scopeSpecialistId) : query.is('specialist_id', null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function validSpecialistId(
  db: SupabaseClient,
  accountId: string,
  specialistId: string
): Promise<boolean> {
  const { data, error } = await db
    .from('specialists')
    .select('id')
    .eq('id', specialistId)
    .eq('account_id', accountId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
