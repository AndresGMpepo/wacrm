import { NextResponse } from 'next/server'

import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'
import { AgendaProApiError, updateAgendaProBooking } from '@/lib/agendapro/server'
import { AGENDAPRO_STATUS_OPTIONS } from '@/lib/agendapro/status-colors'

const EDITABLE_STATUS_IDS = new Set<number>(AGENDAPRO_STATUS_OPTIONS.map((option) => option.id))

/**
 * PATCH /api/agendapro/bookings/{id} — status quick-change from the
 * calendar's booking popover (see editar-una-reserva in
 * developers.agendapro.com/v1.0). Only status_id is exposed here;
 * rescheduling/reassigning a provider goes through AgendaPro directly
 * for now. "Cancelado" is deliberately not a valid status_id — that's
 * a separate endpoint this integration doesn't implement.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { accountId } = await requireAccountModule('agendapro', 'agent')
    const { id } = await params
    const bookingId = Number(id)
    if (!Number.isInteger(bookingId)) {
      return NextResponse.json({ error: 'Id de reserva inválido.' }, { status: 400 })
    }
    const body = await request.json().catch(() => null) as { status_id?: unknown } | null
    const statusId = Number(body?.status_id)
    if (!EDITABLE_STATUS_IDS.has(statusId)) {
      return NextResponse.json({ error: 'Estado inválido.' }, { status: 400 })
    }
    const updated = await updateAgendaProBooking(accountId, bookingId, { status_id: statusId })
    return NextResponse.json({ booking: updated })
  } catch (error) {
    if (error instanceof AgendaProApiError && error.status === 422) {
      return NextResponse.json({ error: 'AgendaPro rechazó el cambio — probablemente la política de edición de la cita no lo permite (muy cerca de la hora, límite de cambios, etc.).' }, { status: 422 })
    }
    return toErrorResponse(error)
  }
}
