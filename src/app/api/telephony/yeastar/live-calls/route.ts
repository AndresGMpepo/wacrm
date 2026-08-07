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
    const [callsResult, extensionsResult, membersResult, channelsResult] = await Promise.all([
      db.from('yeastar_live_calls').select('call_id, extension, channel_id, peer_number, direction, status, call_path, last_event_at')
        .eq('account_id', accountId).order('last_event_at', { ascending: false }).limit(100),
      db.from('telephony_user_configs').select('user_id, extension').eq('account_id', accountId).eq('provider', 'yeastar'),
      db.from('profiles').select('user_id, full_name, avatar_url').eq('account_id', accountId),
      db.from('yeastar_live_call_channels').select('call_id').eq('account_id', accountId),
    ])
    if (callsResult.error) throw callsResult.error
    if (extensionsResult.error) throw extensionsResult.error
    if (membersResult.error) throw membersResult.error
    if (channelsResult.error) throw channelsResult.error
    const usersByExtension = new Map((extensionsResult.data ?? []).map((row) => [row.extension, row.user_id]))
    const memberById = new Map((membersResult.data ?? []).map((row) => [row.user_id, row]))
    // A customer number must never be rendered as an agent extension. The
    // webhook handler persists only configured extensions; this filter also
    // hides any legacy row written before that protection existed.
    const channelCallIds = new Set((channelsResult.data ?? []).map((channel) => channel.call_id))
    const latestByExtension = new Map<string, NonNullable<typeof callsResult.data>[number]>()
    const staleSoftphoneBefore = Date.now() - 45_000
    for (const call of callsResult.data ?? []) {
      if (!usersByExtension.has(call.extension)) continue
      const isSoftphoneCall = call.channel_id.startsWith('wacrm:')
      // PBX rows remain visible only while at least one associated PBX channel
      // is active. This removes historical ALERT/ANSWER rows once BYE arrives.
      if (!isSoftphoneCall && !channelCallIds.has(call.call_id)) continue
      // Browser-originated calls send a heartbeat every 15 seconds. If the
      // tab closes before its final DELETE reaches us, hide that stale row
      // without expiring long-running PBX-originated calls.
      if (isSoftphoneCall && new Date(call.last_event_at).getTime() < staleSoftphoneBefore) continue
      const current = latestByExtension.get(call.extension)
      if (!current || new Date(call.last_event_at).getTime() > new Date(current.last_event_at).getTime()) latestByExtension.set(call.extension, call)
    }
    const calls = [...latestByExtension.values()].map((call) => {
      const member = memberById.get(usersByExtension.get(call.extension) ?? '')
      const rawCallId = call.call_id.replace(/^wacrm:/, '')
      return {
        ...call,
        agent: member ? { name: member.full_name, avatarUrl: member.avatar_url } : null,
        listenReady: !call.channel_id.startsWith('wacrm:') || channelCallIds.has(rawCallId),
      }
    })
    return NextResponse.json({ calls })
  } catch (error) {
    return toErrorResponse(error)
  }
}
