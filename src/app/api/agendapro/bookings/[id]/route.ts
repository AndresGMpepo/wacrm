import { NextResponse } from 'next/server'

import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'
import {
  AgendaProApiError,
  cancelAgendaProBooking,
  syncLocalAgendaProBooking,
  updateAgendaProBooking,
} from '@/lib/agendapro/server'
import { AGENDAPRO_STATUS_OPTIONS } from '@/lib/agendapro/status-colors'

const EDITABLE_STATUS_IDS = new Set<number>(AGENDAPRO_STATUS_OPTIONS.map((option) => option.id))

const POLICY_REJECTED = 'AgendaPro rechazó el cambio — probablemente la política de edición de la cita no lo permite (muy cerca de la hora, límite de cambios, etc.).'

function parseBookingId(raw: string) {
  const bookingId = Number(raw)
  return Number.isInteger(bookingId) && bookingId > 0 ? bookingId : null
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value))
}

/**
 * PATCH /api/agendapro/bookings/{id} — editar-una-reserva
 * (developers.agendapro.com/v1.0). Two shapes, never mixed:
 *  - `{ status_id }`: status quick-change from the calendar popover. Only
 *    the six documented non-cancelled ids — cancelling is DELETE below.
 *  - `{ start, end, provider_id? }`: reschedule. The calendar always sends
 *    a slot exactly as AgendaPro's own available_hours returned it, so
 *    the timestamp format/timezone is AgendaPro's, not ours.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { accountId } = await requireAccountModule('agendapro', 'agent')
    const bookingId = parseBookingId((await params).id)
    if (!bookingId) return NextResponse.json({ error: 'Id de reserva inválido.' }, { status: 400 })
    const body = await request.json().catch(() => null) as {
      status_id?: unknown; start?: unknown; end?: unknown; provider_id?: unknown
    } | null

    let update: { status_id?: number; start?: string; end?: string; provider_id?: number }
    if (body?.start !== undefined || body?.end !== undefined) {
      if (!isTimestamp(body.start) || !isTimestamp(body.end) || Date.parse(body.end) <= Date.parse(body.start)) {
        return NextResponse.json({ error: 'Horario inválido para reagendar.' }, { status: 400 })
      }
      update = { start: body.start, end: body.end }
      if (body.provider_id !== undefined) {
        const providerId = Number(body.provider_id)
        if (!Number.isInteger(providerId) || providerId <= 0) {
          return NextResponse.json({ error: 'Prestador inválido.' }, { status: 400 })
        }
        update.provider_id = providerId
      }
    } else {
      const statusId = Number(body?.status_id)
      if (!EDITABLE_STATUS_IDS.has(statusId)) {
        return NextResponse.json({ error: 'Estado inválido.' }, { status: 400 })
      }
      update = { status_id: statusId }
    }

    const updated = await updateAgendaProBooking(accountId, bookingId, update)
    await syncLocalAgendaProBooking(accountId, updated)
    return NextResponse.json({ booking: updated })
  } catch (error) {
    if (error instanceof AgendaProApiError && error.status === 422) {
      return NextResponse.json({ error: POLICY_REJECTED }, { status: 422 })
    }
    return toErrorResponse(error)
  }
}

/**
 * DELETE /api/agendapro/bookings/{id} — cancels the booking in AgendaPro
 * (eliminar-una-reserva: the documented response is the same booking with
 * status "Cancelado", not a hard delete).
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { accountId } = await requireAccountModule('agendapro', 'agent')
    const bookingId = parseBookingId((await params).id)
    if (!bookingId) return NextResponse.json({ error: 'Id de reserva inválido.' }, { status: 400 })
    const cancelled = await cancelAgendaProBooking(accountId, bookingId)
    await syncLocalAgendaProBooking(accountId, cancelled)
    return NextResponse.json({ booking: cancelled })
  } catch (error) {
    if (error instanceof AgendaProApiError && error.status === 422) {
      return NextResponse.json({ error: POLICY_REJECTED }, { status: 422 })
    }
    return toErrorResponse(error)
  }
}
