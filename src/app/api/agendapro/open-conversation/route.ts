import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'
import { resolveAgendaProWhatsApp } from '@/lib/agendapro/open-whatsapp'
import { SendMessageError } from '@/lib/whatsapp/send-message'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Falta la configuración del servidor.')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

/**
 * Resolves (find-or-creates) the NexoOmni contact + WhatsApp
 * conversation for a phone number, so the calendar's booking popover
 * can send the agent straight to the Inbox to write a message/template
 * from the platform — instead of a `wa.me` link, which would open the
 * agent's own personal WhatsApp outside NexoOmni entirely (no record,
 * no template, no shared inbox).
 *
 * Works for both native (Meta Cloud API) and Zernio-connected
 * WhatsApp — see resolveAgendaProWhatsApp for why those two need
 * different handling. `omnichannel_connectors` is admin-only under
 * RLS (see /api/inbox/whatsapp-status), so this check runs on the
 * service-role client regardless of the calling agent's role.
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

    const db = admin()
    const [{ data: nativeConfig }, { data: zernioConnectors }] = await Promise.all([
      db.from('whatsapp_config').select('id').eq('account_id', accountId).maybeSingle(),
      db
        .from('omnichannel_connectors')
        .select('id, display_name')
        .eq('account_id', accountId)
        .eq('provider', 'zernio_whatsapp')
        .in('status', ['configured', 'active'])
        .order('created_at', { ascending: true }),
    ])

    const result = await resolveAgendaProWhatsApp(
      supabase,
      accountId,
      phone,
      name,
      Boolean(nativeConfig),
      (zernioConnectors ?? []).map((c) => ({ id: c.id as string, displayName: c.display_name as string })),
    )

    if (result.kind === 'conversation') {
      return NextResponse.json({ conversation_id: result.conversationId })
    }
    return NextResponse.json({
      needs_template: true,
      contact_id: result.contactId,
      connectors: result.connectors,
    })
  } catch (error) {
    if (error instanceof SendMessageError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return toErrorResponse(error)
  }
}
