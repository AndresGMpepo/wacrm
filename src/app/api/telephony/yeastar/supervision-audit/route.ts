import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

export const dynamic = 'force-dynamic'

function admin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET() {
  try {
    const { accountId } = await requireRole('admin')
    const db = admin()
    const { data: entries, error } = await db.from('yeastar_call_supervision_audit')
      .select('id, supervisor_user_id, supervisor_extension, target_extension, mode, outcome, error_message, created_at')
      .eq('account_id', accountId).order('created_at', { ascending: false }).limit(30)
    if (error) throw error
    const userIds = [...new Set((entries ?? []).map((entry) => entry.supervisor_user_id))]
    const { data: profiles, error: profilesError } = userIds.length
      ? await db.from('profiles').select('user_id, full_name').in('user_id', userIds)
      : { data: [], error: null }
    if (profilesError) throw profilesError
    const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.full_name]))
    return NextResponse.json({ entries: (entries ?? []).map((entry) => ({
      id: entry.id,
      supervisor: names.get(entry.supervisor_user_id) ?? 'Supervisor',
      supervisor_extension: entry.supervisor_extension,
      target_extension: entry.target_extension,
      mode: entry.mode,
      outcome: entry.outcome,
      error_message: entry.outcome === 'failed' ? entry.error_message : null,
      created_at: entry.created_at,
    })) })
  } catch (error) {
    return toErrorResponse(error)
  }
}
