import { createClient as createAdminClient } from '@supabase/supabase-js'

function admin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

/** Records an appointment lifecycle event (attended / no-show / cancelled /
 *  rescheduled) into the contact's Nexo Memory timeline. Uses the service-role
 *  client because contact_memory_events has no authenticated INSERT policy —
 *  writes are meant to come from trusted server-side code, not directly from
 *  the client. */
export async function recordAppointmentMemoryEvent(args: { accountId: string; contactId: string; appointmentId: string; summary: string; importance?: 'low' | 'normal' | 'high' }) {
  await admin().from('contact_memory_events').insert({
    account_id: args.accountId,
    contact_id: args.contactId,
    event_type: 'manual',
    summary: args.summary.slice(0, 500),
    importance: args.importance ?? 'normal',
    confidence: 1,
    source_type: 'manual',
    source_id: args.appointmentId,
  })
}

/** A missed/cancelled appointment should turn into a concrete pending
 *  follow-up, not just a note in the timeline — skips creating a duplicate
 *  if one is already pending. */
export async function upsertAppointmentFollowUp(args: { accountId: string; contactId: string; appointmentId: string; description: string }) {
  const db = admin()
  const { data: existing } = await db.from('contact_commitments').select('id')
    .eq('contact_id', args.contactId).eq('status', 'pending').ilike('description', args.description).maybeSingle()
  if (existing) return
  await db.from('contact_commitments').insert({
    account_id: args.accountId,
    contact_id: args.contactId,
    description: args.description.slice(0, 300),
    owner: 'agent',
    due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    source_type: 'manual',
    source_id: args.appointmentId,
  })
}
