import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'

export const dynamic = 'force-dynamic'

type CallMember = {
  extension?: { number?: string; channel_id?: string; member_status?: string; call_path?: string }
  inbound?: { from?: string; to?: string; member_status?: string }
  outbound?: { from?: string; to?: string; member_status?: string }
  internal?: { from?: string; to?: string; member_status?: string }
}

function admin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

function validSignature(rawBody: string, secret: string, received: string | null) {
  if (!received) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('base64')
  const actual = Buffer.from(received)
  const expectedBuffer = Buffer.from(expected)
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer)
}

function parseEvent(raw: unknown): { callId: string; members: CallMember[] } | null {
  if (!raw || typeof raw !== 'object') return null
  const body = raw as { type?: unknown; msg?: unknown }
  if (Number(body.type) !== 30011) return null
  const message = typeof body.msg === 'string'
    ? JSON.parse(body.msg) as unknown
    : body.msg
  if (!message || typeof message !== 'object') return null
  const value = message as { call_id?: unknown; members?: unknown }
  return typeof value.call_id === 'string' && Array.isArray(value.members)
    ? { callId: value.call_id, members: value.members as CallMember[] }
    : null
}

function callPeer(members: CallMember[]) {
  for (const member of members) {
    if (member.inbound) return { peerNumber: member.inbound.from ?? member.inbound.to ?? null, direction: 'inbound' as const }
    if (member.outbound) return { peerNumber: member.outbound.to ?? member.outbound.from ?? null, direction: 'outbound' as const }
    if (member.internal) return { peerNumber: member.internal.to ?? member.internal.from ?? null, direction: 'internal' as const }
  }
  return { peerNumber: null, direction: 'unknown' as const }
}

function details(member: CallMember, peer: ReturnType<typeof callPeer>) {
  const extension = member.extension
  if (!extension?.number || !extension.channel_id || !extension.member_status) return null
  return { extension, ...peer }
}

export async function POST(request: Request, context: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await context.params
  const rawBody = await request.text()
  const db = admin()
  const { data: config, error: configError } = await db.from('yeastar_monitoring_configs')
    .select('webhook_secret').eq('account_id', accountId).maybeSingle()
  if (configError || !config?.webhook_secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let secret: string
  try {
    secret = decrypt(config.webhook_secret)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!validSignature(rawBody, secret, request.headers.get('x-signature'))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: ReturnType<typeof parseEvent>
  try {
    event = parseEvent(JSON.parse(rawBody))
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  // Yeastar uses the same webhook endpoint for connectivity tests and other
  // subscribed events. Acknowledge those quickly without recording them.
  if (!event) return NextResponse.json({ received: true })

  const peer = callPeer(event.members)
  for (const member of event.members) {
    const call = details(member, peer)
    if (!call) continue
    if (call.extension.member_status === 'BYE') {
      await db.from('yeastar_live_calls').delete()
        .eq('account_id', accountId).eq('call_id', event.callId).eq('extension', call.extension.number)
      continue
    }
    const { error } = await db.from('yeastar_live_calls').upsert({
      account_id: accountId,
      call_id: event.callId,
      extension: call.extension.number,
      channel_id: call.extension.channel_id,
      peer_number: call.peerNumber,
      direction: call.direction,
      status: call.extension.member_status,
      call_path: call.extension.call_path ?? null,
      last_event_at: new Date().toISOString(),
    }, { onConflict: 'account_id,call_id,extension' })
    if (error) return NextResponse.json({ error: 'Could not persist event' }, { status: 500 })
  }
  return NextResponse.json({ received: true })
}
