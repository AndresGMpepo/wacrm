import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { derivePresence, type StoredPresence } from '@/lib/presence'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

export const dynamic = 'force-dynamic'

function admin() { return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) }

export async function GET() {
  try {
    const { accountId } = await requireRole('admin')
    const db = admin()
    const [profilesResult, presenceResult, conversationsResult, extensionsResult, callsResult, analysesResult] = await Promise.all([
      db.from('profiles').select('user_id, full_name, account_role').eq('account_id', accountId).order('full_name'),
      db.from('member_presence').select('user_id, status, last_seen_at').eq('account_id', accountId),
      db.from('conversations').select('id, assigned_agent_id').eq('account_id', accountId).eq('status', 'open'),
      db.from('telephony_user_configs').select('user_id, extension').eq('account_id', accountId).eq('provider', 'yeastar'),
      db.from('yeastar_live_calls').select('extension').eq('account_id', accountId),
      db.from('ai_conversation_analyses').select('conversation_id').eq('account_id', accountId).eq('status', 'completed').eq('sentiment', 'negative'),
    ])
    for (const result of [profilesResult, presenceResult, conversationsResult, extensionsResult, callsResult, analysesResult]) if (result.error) throw result.error
    const negativeIds = new Set((analysesResult.data ?? []).map((entry) => entry.conversation_id))
    const openByAgent = new Map<string, number>()
    const negativeByAgent = new Map<string, { count: number; conversationId: string }>()
    for (const conversation of conversationsResult.data ?? []) {
      if (!conversation.assigned_agent_id) continue
      openByAgent.set(conversation.assigned_agent_id, (openByAgent.get(conversation.assigned_agent_id) ?? 0) + 1)
      if (negativeIds.has(conversation.id)) {
        const previous = negativeByAgent.get(conversation.assigned_agent_id)
        negativeByAgent.set(conversation.assigned_agent_id, {
          count: (previous?.count ?? 0) + 1,
          // Any current critical conversation provides a direct and safe
          // starting point; opening it never mutates the customer thread.
          conversationId: previous?.conversationId ?? conversation.id,
        })
      }
    }
    const presenceByUser = new Map((presenceResult.data ?? []).map((entry) => [entry.user_id, entry]))
    const extensionByUser = new Map((extensionsResult.data ?? []).map((entry) => [entry.user_id, entry.extension]))
    const activeExtensions = new Set((callsResult.data ?? []).map((entry) => entry.extension))
    const now = Date.now()
    return NextResponse.json({ agents: (profilesResult.data ?? []).map((profile) => {
      const presence = presenceByUser.get(profile.user_id)
      const extension = extensionByUser.get(profile.user_id) ?? null
      const storedPresence = derivePresence(presence?.status as StoredPresence | undefined, presence?.last_seen_at, now)
      // This board answers whether the agent still has a connected WACRM
      // session. "Away" means no recent mouse/keyboard input, not a closed
      // session, so it remains green here; offline still requires a stale beat.
      const operationalPresence = storedPresence === 'away' ? 'online' : storedPresence
      const negative = negativeByAgent.get(profile.user_id)
      return {
        id: profile.user_id,
        name: profile.full_name || 'Agente sin nombre',
        role: profile.account_role,
        presence: operationalPresence,
        extension,
        in_call: Boolean(extension && activeExtensions.has(extension)),
        open_conversations: openByAgent.get(profile.user_id) ?? 0,
        negative_conversations: negative?.count ?? 0,
        critical_conversation_id: negative?.conversationId ?? null,
      }
    }), refreshed_at: new Date().toISOString() })
  } catch (error) { return toErrorResponse(error) }
}
