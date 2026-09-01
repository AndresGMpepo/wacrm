import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { downloadZernioInboundMedia, resolveZernioAttachmentUrl, type ZernioChannel } from '@/lib/zernio/server'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase server configuration')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

/**
 * Streams inbound Zernio media (WhatsApp today) to the browser.
 *
 * Per https://docs.zernio.com/messages/get-message-attachment, webhook
 * payloads never carry a working, non-expiring URL — the documented way
 * to resolve one is `GET .../messages/{platformMessageId}/attachments/0`
 * with our server-side ZERNIO_API_KEY. A plain <img>/<audio> src can't
 * attach that key, so this route resolves + re-streams the bytes
 * same-origin instead.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { messageId } = await params

    const { data: message, error } = await supabase
      .from('messages')
      .select('media_url, platform_message_id, conversation:conversations!inner(account_id, channel_type, external_session_id, connector_id)')
      .eq('id', messageId)
      .single()

    if (error || !message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    const conversation = Array.isArray(message.conversation) ? message.conversation[0] : message.conversation
    if (!conversation || conversation.account_id !== accountId) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    const channelType = conversation.channel_type as string | null
    if (!channelType?.startsWith('zernio_') || !message.media_url) {
      return NextResponse.json({ error: 'This message has no Zernio media.' }, { status: 400 })
    }
    const zernioChannel = channelType.slice('zernio_'.length) as ZernioChannel

    // omnichannel_connectors is admin-only under RLS, so a non-admin
    // agent's session can't read it directly — use the service role,
    // scoped defensively by account_id below.
    let zernioAccountId: string | null = null
    if (conversation.connector_id) {
      const { data: connector } = await admin()
        .from('omnichannel_connectors')
        .select('zernio_account_id')
        .eq('id', conversation.connector_id)
        .eq('account_id', accountId)
        .maybeSingle()
      zernioAccountId = connector?.zernio_account_id ?? null
    }

    let bytes: Buffer
    let mimeType: string | null
    if (zernioAccountId && conversation.external_session_id && message.platform_message_id) {
      const freshUrl = await resolveZernioAttachmentUrl(
        conversation.external_session_id,
        zernioAccountId,
        message.platform_message_id,
      )
      const res = await fetch(freshUrl, { redirect: 'error', signal: AbortSignal.timeout(15_000) })
      if (!res.ok) throw new Error(`No se pudo descargar el medio de Zernio (${res.status}).`)
      bytes = Buffer.from(await res.arrayBuffer())
      mimeType = res.headers.get('content-type')
    } else {
      // Fallback for older rows saved before platform_message_id was
      // reliably populated.
      const downloaded = await downloadZernioInboundMedia(message.media_url, zernioChannel)
      bytes = downloaded.bytes
      mimeType = downloaded.mimeType
    }

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': mimeType || 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith('La ') || error.message.startsWith('No '))) {
      return NextResponse.json({ error: error.message }, { status: 502 })
    }
    return toErrorResponse(error)
  }
}

