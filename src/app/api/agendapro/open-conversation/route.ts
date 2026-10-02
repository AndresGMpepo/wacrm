import { NextResponse } from 'next/server'

import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation'
import { SendMessageError } from '@/lib/whatsapp/send-message'

/**
 * Resolves (find-or-creates) the NexoOmni contact + WhatsApp
 * conversation for a phone number, so the calendar's booking popover
 * can send the agent straight to the Inbox to write a message/template
 * from the platform — instead of a `wa.me` link, which would open the
 * agent's own personal WhatsApp outside NexoOmni entirely (no record,
 * no template, no shared inbox).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireAccountModule('agendapro', 'agent')
    const body = await request.json().catch(() => null) as { phone?: unknown; name?: unknown } | null
    const phone = typeof body?.phone === 'string' ? body.phone : ''
    const name = typeof body?.name === 'string' ? body.name : null
    if (!phone.trim()) {
      return NextResponse.json({ error: 'Falta el teléfono del cliente.' }, { status: 400 })
    }
    const { conversationId } = await resolveConversationByPhone(supabase, accountId, phone, name)
    return NextResponse.json({ conversation_id: conversationId })
  } catch (error) {
    if (error instanceof SendMessageError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return toErrorResponse(error)
  }
}
