import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

const defaults = { enabled: false, mode: 'round_robin' as const, backup_agent_id: null as string | null }

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const [policyResult, agentsResult] = await Promise.all([
      supabase
        .from('conversation_assignment_policies')
        .select('enabled, mode, backup_agent_id')
        .eq('account_id', accountId)
        .maybeSingle(),
      supabase
        .from('profiles')
        .select('user_id, full_name')
        .eq('account_id', accountId)
        .eq('is_active', true)
        .in('account_role', ['owner', 'admin', 'agent'])
        .order('full_name'),
    ])
    if (policyResult.error) throw policyResult.error
    if (agentsResult.error) throw agentsResult.error
    return NextResponse.json({ policy: policyResult.data ?? defaults, agents: agentsResult.data ?? [] })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const enabled = body?.enabled === true
    const mode = body?.mode === 'least_open' ? 'least_open' : 'round_robin'

    // REQ-05: backup agent is admin/owner-only configuration — enforced
    // above via requireRole('admin'). null clears it (no backup fallback).
    let backupAgentId: string | null = null
    if (typeof body?.backup_agent_id === 'string' && body.backup_agent_id.trim()) {
      const candidate = body.backup_agent_id.trim()
      const { data: member, error: memberError } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('user_id', candidate)
        .eq('account_id', accountId)
        .eq('is_active', true)
        .in('account_role', ['owner', 'admin', 'agent'])
        .maybeSingle()
      if (memberError) throw memberError
      if (!member) {
        return NextResponse.json({ error: 'El agente de respaldo debe ser un miembro activo de la cuenta.' }, { status: 400 })
      }
      backupAgentId = candidate
    }

    const { error } = await supabase
      .from('conversation_assignment_policies')
      .upsert({ account_id: accountId, enabled, mode, backup_agent_id: backupAgentId })
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}

