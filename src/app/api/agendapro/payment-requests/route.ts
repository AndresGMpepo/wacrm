import { NextResponse } from 'next/server'

import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'
import { cancelAgendaProPaymentRequest, createAgendaProPaymentRequest } from '@/lib/agendapro/server'

/**
 * AgendaPro payment requests are created on an existing CART
 * (`POST /v3/carts/{id}/payment_requests`), not directly for a client —
 * `cart_id` must already exist (e.g. created alongside a booking/sale).
 * Building the cart itself is NOT wired up yet (the exact cart-item
 * shape wasn't confirmed from the docs this pass) — this route only
 * wraps the payment-request step. See src/lib/agendapro/server.ts's
 * createAgendaProCart() for the deliberately generic passthrough.
 */
export async function POST(request: Request) {
  try {
    const { accountId } = await requireAccountModule('agendapro', 'agent')
    const body = await request.json().catch(() => null) as { cart_id?: unknown } | null
    const cartId = Number(body?.cart_id)
    if (!cartId) return NextResponse.json({ error: 'Indica el cart_id del carrito de AgendaPro.' }, { status: 400 })
    const result = await createAgendaProPaymentRequest(accountId, cartId)
    return NextResponse.json({ payment_request: result }, { status: 201 })
  } catch (error) { return toErrorResponse(error) }
}

export async function DELETE(request: Request) {
  try {
    const { accountId } = await requireAccountModule('agendapro', 'agent')
    const url = new URL(request.url)
    const paymentRequestId = Number(url.searchParams.get('id'))
    if (!paymentRequestId) return NextResponse.json({ error: 'Indica el id de la solicitud de pago.' }, { status: 400 })
    const result = await cancelAgendaProPaymentRequest(accountId, paymentRequestId)
    return NextResponse.json({ payment_request: result })
  } catch (error) { return toErrorResponse(error) }
}
