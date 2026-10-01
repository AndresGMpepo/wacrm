import { createClient as createAdminClient } from '@supabase/supabase-js'

function admin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

/** Records an AgendaPro booking/payment event into the contact's Nexo Memory
 *  timeline. Deliberately a separate helper from src/lib/appointments/memory.ts —
 *  AgendaPro is an independent module, not part of the internal Appointments
 *  feature, even though both end up in the same shared `contact_memory_events`
 *  table. Uses the service-role client since that table has no authenticated
 *  INSERT policy (writes are meant to come from trusted server-side code). */
export async function recordAgendaProMemoryEvent(args: { accountId: string; contactId: string; sourceId: string; summary: string; importance?: 'low' | 'normal' | 'high' }) {
  await admin().from('contact_memory_events').insert({
    account_id: args.accountId,
    contact_id: args.contactId,
    event_type: 'manual',
    summary: args.summary.slice(0, 500),
    importance: args.importance ?? 'normal',
    confidence: 1,
    source_type: 'manual',
    source_id: args.sourceId,
  })
}
