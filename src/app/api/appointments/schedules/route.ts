import { NextResponse } from 'next/server'

import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'

const SELECT = 'id, specialist_id, agent_user_id, weekday, start_time, end_time, timezone, slot_minutes, buffer_minutes, is_active'

function timeValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  return match ? `${match[1]}:${match[2]}:00` : null
}

/**
 * Working hours behind appointment availability.
 *
 * A row belongs to a specialist, to an agent, or to neither — and "neither"
 * is the account's default, used by any resource without hours of its own.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireAccountModule('appointments', 'agent')
    const { data, error } = await supabase
      .from('appointment_schedules')
      .select(SELECT)
      .eq('account_id', accountId)
      .order('weekday')
      .order('start_time')
    if (error) throw error
    return NextResponse.json({ schedules: data ?? [] })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireAccountModule('appointments', 'admin')
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null

    const weekday = Number(body?.weekday)
    const startTime = timeValue(body?.start_time)
    const endTime = timeValue(body?.end_time)
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !startTime || !endTime || endTime <= startTime) {
      return NextResponse.json({ error: 'Indica un día y un horario válidos.' }, { status: 400 })
    }

    const specialistId = typeof body?.specialist_id === 'string' && body.specialist_id ? body.specialist_id : null
    const agentUserId = typeof body?.agent_user_id === 'string' && body.agent_user_id ? body.agent_user_id : null
    if (specialistId && agentUserId) {
      return NextResponse.json({ error: 'Un horario pertenece a un especialista o a un agente, no a ambos.' }, { status: 400 })
    }
    if (specialistId) {
      const { data } = await supabase.from('specialists').select('id').eq('id', specialistId).eq('account_id', accountId).maybeSingle()
      if (!data) return NextResponse.json({ error: 'El especialista no existe en esta cuenta.' }, { status: 400 })
    }
    if (agentUserId) {
      const { data } = await supabase.from('profiles').select('user_id').eq('user_id', agentUserId).eq('account_id', accountId).maybeSingle()
      if (!data) return NextResponse.json({ error: 'El agente no pertenece a esta cuenta.' }, { status: 400 })
    }

    const timezone = typeof body?.timezone === 'string' && body.timezone.trim() ? body.timezone.trim().slice(0, 80) : 'UTC'
    try {
      // A bad zone would only surface later, as slots quietly computed in UTC.
      new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    } catch {
      return NextResponse.json({ error: 'La zona horaria no es válida.' }, { status: 400 })
    }

    const bounded = (value: unknown, fallback: number, min: number, max: number) => {
      const parsed = Math.floor(Number(value))
      return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
    }

    const { data, error } = await supabase
      .from('appointment_schedules')
      .insert({
        account_id: accountId,
        specialist_id: specialistId,
        agent_user_id: agentUserId,
        weekday,
        start_time: startTime,
        end_time: endTime,
        timezone,
        slot_minutes: bounded(body?.slot_minutes, 30, 5, 480),
        buffer_minutes: bounded(body?.buffer_minutes, 0, 0, 240),
      })
      .select(SELECT)
      .single()
    if (error) throw error
    return NextResponse.json({ schedule: data }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, accountId } = await requireAccountModule('appointments', 'admin')
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Indica el horario a eliminar.' }, { status: 400 })
    const { error } = await supabase
      .from('appointment_schedules')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
