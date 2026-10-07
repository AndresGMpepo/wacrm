import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'

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
  if (!url || !key) throw new Error('Missing Supabase server configuration')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

function graphVersion() {
  const configured = process.env.META_GRAPH_API_VERSION?.trim()
  return /^v\d+\.\d+$/.test(configured ?? '') ? configured as string : 'v22.0'
}

/**
 * typing_on / typing_off / mark_seen — Meta's "sender actions"
 * (https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/sender-actions/).
 * Purely cosmetic parity with Meta's own Page Inbox (the customer sees
 * "typing…" and "seen" the same way they would there); nothing here is
 * ever critical, so every failure is swallowed into a generic ok:false
 * instead of surfacing a toast — a dropped typing indicator must never
 * look like a broken send to the agent.
 */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireEntitlement('social_messaging', 'agent')
    const limit = checkRateLimit(`omnichannel:meta:sender-action:${userId}`, RATE_LIMITS.senderAction)
    if (!limit.success) return rateLimitResponse(limit)
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id.trim() : ''
    const action = body?.action
    if (!conversationId || !isSenderAction(action)) return NextResponse.json({ ok: false }, { status: 400 })

    const db = admin()
    const { data: conversation } = await db.from('conversations')
      .select('id, connector_id, external_session_id, channel_type, social_comment_id')
      .eq('id', conversationId).eq('account_id', accountId).in('channel_type', ['facebook', 'instagram']).maybeSingle()
    // A public comment thread has no PSID to address a sender action to —
    // not an error, just nothing to do.
    if (!conversation?.connector_id || !conversation.external_session_id || conversation.social_comment_id) {
      return NextResponse.json({ ok: false })
    }
    const { data: connector } = await db.from('omnichannel_connectors')
      .select('external_channel_id, meta_access_token, status').eq('id', conversation.connector_id).eq('account_id', accountId).maybeSingle()
    if (!connector?.meta_access_token || connector.status === 'paused') return NextResponse.json({ ok: false })
    let accessToken: string
    try { accessToken = decrypt(connector.meta_access_token) } catch { return NextResponse.json({ ok: false }) }

    const authHeader = ['Bearer', accessToken].join(' ')
    const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(connector.external_channel_id)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ recipient: { id: conversation.external_session_id }, sender_action: action }),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => null)

    return NextResponse.json({ ok: Boolean(response?.ok) })
  } catch (error) { return toErrorResponse(error) }
}
