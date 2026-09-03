import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getAvailableSlots } from '@/lib/appointments/availability'

const MAX_RANGE_DAYS = 60

/**
 * GET /api/appointments/availability  (agent+)
 *
 * Free slots for a specialist or an agent between `from` and `to`, honouring
 * their working hours, holidays, buffer time and everything already booked.
 *
 * Query: specialist_id | agent_id, from, to (ISO), duration (minutes).
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const url = new URL(request.url)

    const specialistId = url.searchParams.get('specialist_id')
    const agentUserId = url.searchParams.get('agent_id')
    const duration = Math.min(480, Math.max(5, Number(url.searchParams.get('duration')) || 30))

    const from = url.searchParams.get('from') ? new Date(url.searchParams.get('from') as string) : new Date()
    const to = url.searchParams.get('to')
      ? new Date(url.searchParams.get('to') as string)
      : new Date(from.getTime() + 7 * 86_400_000)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      return NextResponse.json({ error: 'Rango de fechas inválido.' }, { status: 400 })
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
      return NextResponse.json(
        { error: `Consulta como máximo ${MAX_RANGE_DAYS} días por petición.` },
        { status: 400 },
      )
    }

    if (specialistId) {
      const { data: specialist } = await supabase
        .from('specialists')
        .select('id')
        .eq('id', specialistId)
        .eq('account_id', accountId)
        .maybeSingle()
      if (!specialist) {
        return NextResponse.json({ error: 'El especialista no existe en esta cuenta.' }, { status: 400 })
      }
    }

    const { slots, hasSchedule } = await getAvailableSlots(supabase, {
      accountId,
      specialistId,
      agentUserId,
      from,
      to,
      durationMinutes: duration,
    })

    return NextResponse.json({
      slots,
      duration_minutes: duration,
      // Lets the UI say "configure working hours" instead of "no availability".
      has_schedule: hasSchedule,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
