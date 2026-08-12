import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'

export const dynamic = 'force-dynamic'

type CallMember = {
  extension?: { number?: unknown; channel_id?: string; member_status?: string; call_path?: string }
  inbound?: CallParty
  outbound?: CallParty
  internal?: CallParty
}

type CallParty = { from?: unknown; to?: unknown; channel_id?: string; member_status?: string; call_path?: string }
type TrackedCall = { extension: string; channelId: string; status: string; callPath: string | null; peerNumber: string | null; direction: 'inbound' | 'outbound' | 'internal' | 'unknown' }
type EventChannel = { channelId: string; memberType: 'extension' | 'inbound' | 'outbound' | 'internal'; memberNumber: string | null; fromNumber: string | null; toNumber: string | null; status: string }

function admin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

function validSignature(rawBody: string, secret: string, received: string | null) {
  if (!received) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('base64')
  // Yeastar documents the Base64 value directly. Accept the conventional
  // sha256= prefix as well, since some reverse proxies preserve that form.
  const actual = Buffer.from(received.trim().replace(/^sha256=/i, ''))
  const expectedBuffer = Buffer.from(expected)
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer)
}

function parseEvent(raw: unknown): { eventType: string | null; callId: string; members: CallMember[] } | null {
  if (!raw || typeof raw !== 'object') return null
  const body = raw as { type?: unknown; msg?: unknown }
  const eventType = body.type == null ? null : String(body.type)
  if (Number(body.type) !== 30011) return null
  const message = typeof body.msg === 'string'
    ? JSON.parse(body.msg) as unknown
    : body.msg
  if (!message || typeof message !== 'object') return null
  const value = message as { call_id?: unknown; members?: unknown }
  return value.call_id != null && Array.isArray(value.members)
    ? { eventType, callId: String(value.call_id), members: value.members as CallMember[] }
    : null
}

async function receipt(db: ReturnType<typeof admin>, accountId: string, outcome: 'processed' | 'ignored' | 'rejected' | 'invalid', detail: string, eventType?: string | null, callId?: string | null) {
  await db.from('yeastar_webhook_event_receipts').insert({ account_id: accountId, outcome, detail: detail.slice(0, 500), event_type: eventType ?? null, call_id: callId ?? null })
}

function callPeer(members: CallMember[], extensions: Set<string>) {
  for (const member of members) {
    for (const party of [member.inbound, member.outbound, member.internal]) {
      if (!party) continue
      for (const number of [party.from, party.to]) {
        const value = phoneValue(number)
        if (value && !resolveExtension(value, extensions)) return value
      }
    }
  }
  return null
}

function phoneValue(value: unknown) {
  return value == null ? undefined : String(value).trim() || undefined
}

function resolveExtension(value: unknown, knownExtensions: Set<string>) {
  const number = phoneValue(value)
  if (!number) return undefined
  if (knownExtensions.has(number)) return number
  // Yeastar variants can report a member as PJSIP/1008, 1008@domain, or a
  // numeric JSON value. Match only an exact configured extension token.
  return [...knownExtensions].find((extension) => new RegExp(`(^|[^0-9])${extension}(?![0-9])`).test(number))
}

function trackedCalls(member: CallMember, knownExtensions: Set<string>, fallbackPeer: string | null): TrackedCall[] {
  const calls = new Map<string, TrackedCall>()
  const add = (extension: unknown, channelId: string | undefined, status: string | undefined, callPath: string | undefined, peerNumber: unknown, direction: TrackedCall['direction']) => {
    const configuredExtension = resolveExtension(extension, knownExtensions)
    if (!configuredExtension || !channelId || !status) return
    calls.set(configuredExtension, { extension: configuredExtension, channelId, status, callPath: callPath ?? null, peerNumber: phoneValue(peerNumber) ?? fallbackPeer, direction })
  }

  const extension = member.extension
  add(extension?.number, extension?.channel_id, extension?.member_status, extension?.call_path, undefined, 'unknown')
  // A Yeastar inbound/outbound member can be the only member reported in a
  // notification. Resolve the WACRM agent from the extension side of that leg
  // rather than treating the customer's number as an extension.
  add(member.inbound?.to, member.inbound?.channel_id, member.inbound?.member_status, member.inbound?.call_path, member.inbound?.from, 'inbound')
  add(member.inbound?.from, member.inbound?.channel_id, member.inbound?.member_status, member.inbound?.call_path, member.inbound?.to, 'inbound')
  add(member.outbound?.from, member.outbound?.channel_id, member.outbound?.member_status, member.outbound?.call_path, member.outbound?.to, 'outbound')
  add(member.outbound?.to, member.outbound?.channel_id, member.outbound?.member_status, member.outbound?.call_path, member.outbound?.from, 'outbound')
  add(member.internal?.from, member.internal?.channel_id, member.internal?.member_status, member.internal?.call_path, member.internal?.to, 'internal')
  add(member.internal?.to, member.internal?.channel_id, member.internal?.member_status, member.internal?.call_path, member.internal?.from, 'internal')
  return [...calls.values()]
}

function eventChannels(members: CallMember[]): EventChannel[] {
  const channels = new Map<string, EventChannel>()
  const add = (memberType: EventChannel['memberType'], party: CallParty | undefined, memberNumber: unknown) => {
    if (!party?.channel_id || !party.member_status) return
    channels.set(party.channel_id, {
      channelId: party.channel_id,
      memberType,
      memberNumber: phoneValue(memberNumber) ?? null,
      fromNumber: phoneValue(party.from) ?? null,
      toNumber: phoneValue(party.to) ?? null,
      status: party.member_status,
    })
  }
  for (const member of members) {
    if (member.extension?.channel_id && member.extension.member_status) {
      channels.set(member.extension.channel_id, {
        channelId: member.extension.channel_id,
        memberType: 'extension',
        memberNumber: phoneValue(member.extension.number) ?? null,
        fromNumber: null,
        toNumber: null,
        status: member.extension.member_status,
      })
    }
    add('inbound', member.inbound, member.inbound?.to)
    add('outbound', member.outbound, member.outbound?.from)
    add('internal', member.internal, member.internal?.to ?? member.internal?.from)
  }
  return [...channels.values()]
}

async function persistEventChannels(db: ReturnType<typeof admin>, accountId: string, callId: string, members: CallMember[]) {
  for (const channel of eventChannels(members)) {
    if (channel.status === 'BYE') {
      const { error } = await db.from('yeastar_live_call_channels').delete()
        .eq('account_id', accountId).eq('call_id', callId).eq('channel_id', channel.channelId)
      if (error) throw error
      continue
    }
    const { error } = await db.from('yeastar_live_call_channels').upsert({
      account_id: accountId,
      call_id: callId,
      channel_id: channel.channelId,
      member_type: channel.memberType,
      member_number: channel.memberNumber,
      from_number: channel.fromNumber,
      to_number: channel.toNumber,
      status: channel.status,
      last_event_at: new Date().toISOString(),
    }, { onConflict: 'account_id,call_id,channel_id' })
    if (error) throw error
  }
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
    await receipt(db, accountId, 'rejected', 'No se pudo descifrar el secreto configurado.')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!validSignature(rawBody, secret, request.headers.get('x-signature'))) {
    await receipt(db, accountId, 'rejected', 'La firma X-Signature no coincide con el secreto configurado.')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: ReturnType<typeof parseEvent>
  try {
    event = parseEvent(JSON.parse(rawBody))
  } catch {
    await receipt(db, accountId, 'invalid', 'El cuerpo recibido no contiene JSON válido.')
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  // Yeastar uses the same webhook endpoint for connectivity tests and other
  // subscribed events. Acknowledge those quickly without recording them.
  if (!event) {
    const payload = JSON.parse(rawBody) as { type?: unknown; event?: unknown }
    await receipt(db, accountId, 'ignored', 'Evento válido recibido, pero no es 30011 Call State Changed.', payload.type == null ? (payload.event == null ? null : String(payload.event)) : String(payload.type))
    return NextResponse.json({ received: true })
  }

  try {
    await persistEventChannels(db, accountId, event.callId, event.members)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido'
    await receipt(db, accountId, 'invalid', `No se pudieron guardar los canales activos: ${message}`, event.eventType, event.callId)
    return NextResponse.json({ error: 'Could not persist channels' }, { status: 500 })
  }

  const { data: configuredExtensions, error: extensionError } = await db.from('telephony_user_configs')
    .select('extension').eq('account_id', accountId).eq('provider', 'yeastar')
  if (extensionError) {
    await receipt(db, accountId, 'invalid', `No se pudieron consultar las extensiones NexoOmni: ${extensionError.message}`, event.eventType, event.callId)
    return NextResponse.json({ error: 'Could not load extensions' }, { status: 500 })
  }
  const knownExtensions = new Set((configuredExtensions ?? []).map((row) => row.extension))
  const peer = callPeer(event.members, knownExtensions)
  const transitions: string[] = []
  for (const member of event.members) {
    const calls = trackedCalls(member, knownExtensions, peer)
    if (!calls.length) {
      transitions.push('Miembro sin una extensión configurada en NexoOmni; no se muestra.')
      continue
    }
    for (const call of calls) {
      if (call.status === 'BYE') {
        await db.from('yeastar_live_calls').delete()
          .eq('account_id', accountId).eq('call_id', event.callId).eq('extension', call.extension)
        transitions.push(`Extensión ${call.extension}: BYE, eliminada por finalización.`)
        continue
      }
      const { error } = await db.from('yeastar_live_calls').upsert({
        account_id: accountId,
        call_id: event.callId,
        extension: call.extension,
        channel_id: call.channelId,
        peer_number: call.peerNumber,
        direction: call.direction,
        status: call.status,
        call_path: call.callPath,
        last_event_at: new Date().toISOString(),
      }, { onConflict: 'account_id,call_id,extension' })
      if (error) {
        await receipt(db, accountId, 'invalid', `No se pudo guardar el estado de llamada: ${error.message}`, event.eventType, event.callId)
        return NextResponse.json({ error: 'Could not persist event' }, { status: 500 })
      }
      transitions.push(`Extensión ${call.extension}: ${call.status}, visible en Supervisión.`)
    }
  }
  await receipt(db, accountId, 'processed', transitions.join(' ') || `Evento 30011 procesado con ${event.members.length} miembro(s), sin una extensión supervisable.`, event.eventType, event.callId)
  return NextResponse.json({ received: true })
}
