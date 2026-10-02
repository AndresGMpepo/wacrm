import { NextResponse } from 'next/server'

import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'
import { createAgendaProPayment, listAgendaProPayments } from '@/lib/agendapro/server'

/**
 * AgendaPro V1's `/payments` records an ALREADY-COLLECTED payment (cash,
 * card, etc., via `transactions[]` + `receipts[].items[]`) — there is no
 * confirmed "payment request / checkout link" concept in this API version
 * (unlike Connect v3's cart-based payment_requests), so this is NOT a
 * "send a payment link via WhatsApp" endpoint. Body is a generic
 * passthrough (see docs.agendapro.com's "Crear Pagos" reference) — no UI
 * is wired up to this yet.
 */
export async function GET() {
  try {
    const { accountId } = await requireAccountModule('agendapro', 'agent')
    const result = await listAgendaProPayments(accountId)
    return NextResponse.json(result)
  } catch (error) { return toErrorResponse(error) }
}

export async function POST(request: Request) {
  try {
    const { accountId } = await requireAccountModule('agendapro', 'agent')
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Cuerpo de solicitud inválido.' }, { status: 400 })
    const result = await createAgendaProPayment(accountId, body)
    return NextResponse.json({ payment: result }, { status: 201 })
  } catch (error) { return toErrorResponse(error) }
}
