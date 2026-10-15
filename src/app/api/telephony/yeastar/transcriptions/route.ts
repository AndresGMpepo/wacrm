import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import { normalizeCallSummary } from '@/lib/telephony/call-summary'

function admin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export async function GET(request: Request) {
  try {
    const { accountId } = await requireEntitlement('yeastar_telephony', 'supervisor')
    const url = new URL(request.url)
    const pageSize = Math.min(100, Math.max(10, positiveInteger(url.searchParams.get('page_size'), 25)))
    const page = positiveInteger(url.searchParams.get('page'), 1)
    const query = url.searchParams.get('q')?.trim()
    const selectedCallId = url.searchParams.get('call')?.trim()
    // Every PBX call event creates a row to track sync progress, but most never get a transcript
    // published by Yeastar. Default to only the ones that actually have transcribed content.
    const onlyTranscribed = url.searchParams.get('only_transcribed') !== 'false'
    if (query && (query.length > 120 || /[,%()]/.test(query))) {
      return NextResponse.json({ error: 'La búsqueda contiene caracteres no permitidos.' }, { status: 400 })
    }
    const db = admin()
    let requestQuery = db.from('yeastar_call_transcriptions')
      .select('id, call_id, session_call_id, cdr_id, contact_id, customer_phone, customer_name, customer_email, agent_user_id, agent_extension, agent_name, direction, started_at, answered_at, ended_at, duration_seconds, routing_duration_seconds, handling_duration_seconds, ring_duration_seconds, hold_duration_seconds, talk_duration_seconds, disconnected_by, timeline, transcript, summary, key_points, action_items, language, transcription_status, analysis_status, memory_applied_at, error_message, created_at, updated_at', { count: 'exact' })
      .eq('account_id', accountId)
      .order('started_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
    if (selectedCallId) requestQuery = requestQuery.eq('id', selectedCallId)
    else {
      if (onlyTranscribed) requestQuery = requestQuery.eq('transcription_status', 'completed').not('transcript', 'is', null)
      if (query) requestQuery = requestQuery.or(`customer_phone.ilike.%${query}%,customer_name.ilike.%${query}%,customer_email.ilike.%${query}%,agent_extension.ilike.%${query}%,agent_name.ilike.%${query}%,transcript.ilike.%${query}%,summary.ilike.%${query}%`)
      requestQuery = requestQuery.range((page - 1) * pageSize, page * pageSize - 1)
    }
    const { data, error, count } = await requestQuery
    if (error) throw error
    const rows = data ?? []
    const contactIds = [...new Set(rows.map((row) => row.contact_id).filter(Boolean))]
    const agentIds = [...new Set(rows.map((row) => row.agent_user_id).filter(Boolean))]
    const sessionIds = [...new Set(rows.map((row) => row.session_call_id ?? row.call_id).filter(Boolean))]
    const [contacts, agents, handoffs] = await Promise.all([
      contactIds.length ? db.from('contacts').select('id, name, phone, email').in('id', contactIds) : Promise.resolve({ data: [], error: null }),
      agentIds.length ? db.from('profiles').select('user_id, full_name, email').in('user_id', agentIds) : Promise.resolve({ data: [], error: null }),
      sessionIds.length ? db.from('yeastar_call_handoffs').select('call_id, summary, customer_need, next_action, created_at').eq('account_id', accountId).in('call_id', sessionIds) : Promise.resolve({ data: [], error: null }),
    ])
    if (contacts.error) throw contacts.error
    if (agents.error) throw agents.error
    if (handoffs.error) throw handoffs.error
    const contactsById = new Map((contacts.data ?? []).map((contact) => [contact.id, contact]))
    const agentsById = new Map((agents.data ?? []).map((agent) => [agent.user_id, agent]))
    const handoffsByCall = new Map((handoffs.data ?? []).map((handoff) => [handoff.call_id, handoff]))
    const total = selectedCallId ? rows.length : count ?? 0
    return NextResponse.json({
      calls: rows.map((row) => {
        const sessionCallId = row.session_call_id ?? row.call_id
        const handoff = handoffsByCall.get(sessionCallId) ?? null
        return {
          ...row,
          session_call_id: sessionCallId,
          summary: normalizeCallSummary(row.summary),
          ai_first_touch: Boolean(handoff),
          ai_handoff: handoff,
          contact: row.contact_id ? contactsById.get(row.contact_id) ?? null : null,
          agent: row.agent_user_id ? agentsById.get(row.agent_user_id) ?? null : null,
        }
      }),
      pagination: {
        page: selectedCallId ? 1 : page,
        page_size: pageSize,
        total,
        total_pages: Math.max(1, Math.ceil(total / pageSize)),
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
