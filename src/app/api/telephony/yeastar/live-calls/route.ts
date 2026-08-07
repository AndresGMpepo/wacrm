import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

function admin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET() {
  try {
    const { accountId } = await requireRole('admin')
    const db = admin()
    const [callsResult, extensionsResult, membersResult] = await Promise.all([
      db.from('yeastar_live_calls').select('call_id, extension, channel_id, peer_number, direction, status, call_path, last_event_at')
        .eq('account_id', accountId).order('last_event_at', { ascending: false }).limit(100),
      db.from('telephony_user_configs').select('user_id, extension').eq('account_id', accountId).eq('provider', 'yeastar'),
      db.from('profiles').select('user_id, full_name, avatar_url').eq('account_id', accountId),
    ])
    if (callsResult.error) throw callsResult.error
    if (extensionsResult.error) throw extensionsResult.error
    if (membersResult.error) throw membersResult.error
    const usersByExtension = new Map((extensionsResult.data ?? []).map((row) => [row.extension, row.user_id]))
    const memberById = new Map((membersResult.data ?? []).map((row) => [row.user_id, row]))
    // A customer number must never be rendered as an agent extension. The
    // webhook handler persists only configured extensions; this filter also
    // hides any legacy row written before that protection existed.
    const calls = (callsResult.data ?? []).filter((call) => usersByExtension.has(call.extension)).map((call) => {
      const member = memberById.get(usersByExtension.get(call.extension) ?? '')
      return { ...call, agent: member ? { name: member.full_name, avatarUrl: member.avatar_url } : null }
    })
    return NextResponse.json({ calls })
  } catch (error) {
    return toErrorResponse(error)
  }
}
