import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { downloadZernioInboundMedia, type ZernioChannel } from '@/lib/zernio/server'

/**
 * Streams inbound Zernio media (WhatsApp today) to the browser.
 *
 * The Zernio CDN for WhatsApp media requires our server-side
 * ZERNIO_API_KEY as a bearer token — a plain <img>/<audio> src pointed
 * straight at `messages.media_url` gets an unauthenticated 401/403,
 * which is why those bubbles showed a broken image / "unavailable"
 * audio. This route looks the URL up server-side and re-streams the
 * authenticated bytes same-origin instead.
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
      .select('media_url, conversation:conversations!inner(account_id, channel_type)')
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
    const { bytes, mimeType } = await downloadZernioInboundMedia(message.media_url, zernioChannel)

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': mimeType || 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('La ')) {
      return NextResponse.json({ error: error.message }, { status: 502 })
    }
    return toErrorResponse(error)
  }
}
