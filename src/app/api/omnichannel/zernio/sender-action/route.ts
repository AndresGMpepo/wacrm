import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'
import { markZernioConversationRead, sendZernioTypingIndicator } from '@/lib/zernio/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

const SENDER_ACTIONS = ['typing_on', 'typing_off', 'mark_seen'] as const
type SenderAction = (typeof SENDER_ACTIONS)[number]

function isSenderAction(value: unknown): value is SenderAction {
  return typeof value === 'string' && (SENDER_ACTIONS as readonly string[]).includes(value)
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Falta la configuración del servidor.')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

/**
 * typing_on / mark_seen via Zernio's unified inbox API — the BSP-routed
 * equivalent of /api/omnichannel/meta/sender-action, for zernio_facebook
 * and zernio_instagram conversations. Zernio has no separate "stop
 * typing" call (POST .../typing auto-expires on the platform, ~20s on
 * Messenger/Instagram); `typing_off` is accepted and silently no-op'd so
 * the composer's shared debounce logic doesn't need to know which
 * provider a conversation uses. Never critical — every failure collapses
 * to a generic ok:false instead of a toast.
 */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireEntitlement('social_messaging', 'agent')
    const limit = checkRateLimit(`omnichannel:zernio:sender-action:${userId}`, RATE_LIMITS.senderAction)
    if (!limit.success) return rateLimitResponse(limit)
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id.trim() : ''
    const action = body?.action
    if (!conversationId || !isSenderAction(action)) return NextResponse.json({ ok: false }, { status: 400 })
    if (action === 'typing_off') return NextResponse.json({ ok: true })

    const db = admin()
    const { data: conversation } = await db.from('conversations')
      .select('id, connector_id, external_session_id, channel_type, social_comment_id')
      .eq('id', conversationId).eq('account_id', accountId)
      .in('channel_type', ['zernio_facebook', 'zernio_instagram']).maybeSingle()
    if (!conversation?.connector_id || !conversation.external_session_id || conversation.social_comment_id) {
      return NextResponse.json({ ok: false })
    }
    const { data: connector } = await db.from('omnichannel_connectors')
      .select('zernio_account_id, status').eq('id', conversation.connector_id).eq('account_id', accountId).maybeSingle()
    if (!connector?.zernio_account_id || connector.status === 'paused') return NextResponse.json({ ok: false })

    if (action === 'mark_seen') {
      await markZernioConversationRead(conversation.external_session_id, connector.zernio_account_id).catch(() => {})
    } else {
      await sendZernioTypingIndicator(conversation.external_session_id, connector.zernio_account_id).catch(() => {})
    }
    return NextResponse.json({ ok: true })
  } catch (error) { return toErrorResponse(error) }
}
