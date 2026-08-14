import crypto from 'node:crypto'

import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

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

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireEntitlement('social_messaging', 'agent')
    const limit = checkRateLimit(`omnichannel:meta:send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id.trim() : ''
    const text = typeof body?.content_text === 'string' ? body.content_text.trim() : ''
    if (!conversationId || !text) return NextResponse.json({ error: 'Indica una conversación y un mensaje.' }, { status: 400 })
    if (text.length > 2_000) return NextResponse.json({ error: 'El mensaje supera el límite de 2,000 caracteres para este canal.' }, { status: 400 })
    const db = admin()
    const { data: conversation, error: conversationError } = await db.from('conversations')
      .select('id, connector_id, external_session_id, channel_type').eq('id', conversationId).eq('account_id', accountId).in('channel_type', ['facebook', 'instagram']).maybeSingle()
    if (conversationError) throw conversationError
    if (!conversation?.connector_id || !conversation.external_session_id || (conversation.channel_type !== 'facebook' && conversation.channel_type !== 'instagram')) {
      return NextResponse.json({ error: 'Esta conversación no tiene un destinatario Meta disponible.' }, { status: 409 })
    }
    const { data: connector, error: connectorError } = await db.from('omnichannel_connectors')
      .select('provider, external_channel_id, meta_access_token, status').eq('id', conversation.connector_id).eq('account_id', accountId).maybeSingle()
    if (connectorError) throw connectorError
    if (!connector?.meta_access_token || connector.status === 'paused') return NextResponse.json({ error: 'El canal Meta está pausado o no tiene un token de envío configurado.' }, { status: 409 })
    let accessToken: string
    try { accessToken = decrypt(connector.meta_access_token) } catch { return NextResponse.json({ error: 'No se pudo leer de forma segura el token de este canal Meta.' }, { status: 503 }) }
    const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(connector.external_channel_id)}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: conversation.external_session_id },
        ...(conversation.channel_type === 'facebook' ? { messaging_type: 'RESPONSE' } : {}),
        message: { text },
        access_token: accessToken,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const payload = await response.json().catch(() => ({})) as { message_id?: string; error?: { message?: string } }
    if (!response.ok || !payload.message_id) {
      const detail = payload.error?.message || `HTTP ${response.status}`
      return NextResponse.json({ error: `Meta rechazó el envío: ${detail}` }, { status: 502 })
    }
    const now = new Date().toISOString()
    const { data: message, error: messageError } = await db.from('messages').insert({
      conversation_id: conversation.id, sender_type: 'agent', sender_id: userId, content_type: 'text', content_text: text,
      message_id: `meta:out:${conversation.connector_id}:${payload.message_id || crypto.randomUUID()}`, status: 'sent', created_at: now,
    }).select().single()
    if (messageError) throw messageError
    const { error: updateError } = await db.from('conversations').update({ last_message_text: text, last_message_at: now, updated_at: now }).eq('id', conversation.id).eq('account_id', accountId)
    if (updateError) throw updateError
    return NextResponse.json({ message })
  } catch (error) { return toErrorResponse(error) }
}
