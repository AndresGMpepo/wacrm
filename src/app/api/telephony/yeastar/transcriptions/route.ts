import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'

function admin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

export async function GET(request: Request) {
  try {
    const { accountId } = await requireEntitlement('yeastar_telephony', 'admin')
    const url = new URL(request.url)
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50)))
    const query = url.searchParams.get('q')?.trim()
    const db = admin()
    let requestQuery = db.from('yeastar_call_transcriptions')
      .select('id, call_id, cdr_id, contact_id, customer_phone, customer_name, customer_email, agent_user_id, agent_extension, direction, started_at, answered_at, ended_at, duration_seconds, recording_url, transcript, summary, key_points, action_items, language, transcription_status, error_message, created_at, updated_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (query) requestQuery = requestQuery.or(`customer_phone.ilike.%${query}%,customer_name.ilike.%${query}%,customer_email.ilike.%${query}%,transcript.ilike.%${query}%,summary.ilike.%${query}%`)
    const { data, error } = await requestQuery
    if (error) throw error
    const rows = data ?? []
    const contactIds = [...new Set(rows.map((row) => row.contact_id).filter(Boolean))]
    const agentIds = [...new Set(rows.map((row) => row.agent_user_id).filter(Boolean))]
    const [contacts, agents] = await Promise.all([
      contactIds.length ? db.from('contacts').select('id, name, phone, email').in('id', contactIds) : Promise.resolve({ data: [], error: null }),
      agentIds.length ? db.from('profiles').select('user_id, full_name, email').in('user_id', agentIds) : Promise.resolve({ data: [], error: null }),
    ])
    if (contacts.error) throw contacts.error
    if (agents.error) throw agents.error
    const contactsById = new Map((contacts.data ?? []).map((contact) => [contact.id, contact]))
    const agentsById = new Map((agents.data ?? []).map((agent) => [agent.user_id, agent]))
    return NextResponse.json({ calls: rows.map((row) => ({
      ...row,
      contact: row.contact_id ? contactsById.get(row.contact_id) ?? null : null,
      agent: row.agent_user_id ? agentsById.get(row.agent_user_id) ?? null : null,
    })) })
  } catch (error) {
    return toErrorResponse(error)
  }
}
