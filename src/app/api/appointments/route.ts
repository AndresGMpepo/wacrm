import { NextResponse } from 'next/server'
import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'
import { syncGoogleAppointment } from '@/lib/appointments/google-calendar'

const STATUSES = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'] as const

function date(value: unknown) {
  if (typeof value !== 'string') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

  function appointmentErrorResponse(error: unknown) {
    const databaseError = error as { code?: string; message?: string } | null
    if (databaseError?.code === '42P01' || databaseError?.code === '42703') {
      return NextResponse.json({ error: 'La base de datos aún no tiene la actualización de Agenda. Aplica las migraciones 091 a 094 y vuelve a intentar.' }, { status: 503 })
    }
    return toErrorResponse(error)
  }

  type AppointmentRow = { assigned_agent_id: string | null; [key: string]: unknown }

  async function withAgents(
    supabase: Awaited<ReturnType<typeof requireAccountModule>>['supabase'],
    accountId: string,
    appointments: AppointmentRow[],
  ) {
    const agentIds = [...new Set(appointments.map((appointment) => appointment.assigned_agent_id).filter((id): id is string => Boolean(id)))]
    if (!agentIds.length) return appointments.map((appointment) => ({ ...appointment, agent: null }))
    const { data, error } = await supabase.from('profiles').select('user_id, full_name').eq('account_id', accountId).in('user_id', agentIds)
    if (error) throw error
    const agents = new Map((data ?? []).map((agent) => [agent.user_id, { full_name: agent.full_name }]))
    return appointments.map((appointment) => ({ ...appointment, agent: appointment.assigned_agent_id ? agents.get(appointment.assigned_agent_id) ?? null : null }))
  }

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireAccountModule('appointments')
    const url = new URL(request.url)
    const from = date(url.searchParams.get('from')) ?? new Date(Date.now() - 7 * 86_400_000).toISOString()
    const to = date(url.searchParams.get('to')) ?? new Date(Date.now() + 30 * 86_400_000).toISOString()
    const { data, error } = await supabase.from('appointments')
      .select('id, contact_id, assigned_agent_id, title, notes, starts_at, ends_at, timezone, status, google_sync_status, google_sync_error, created_at, contact:contacts(name, phone)')
      .eq('account_id', accountId).gte('starts_at', from).lt('starts_at', to).order('starts_at')
    if (error) throw error
    return NextResponse.json({ appointments: await withAgents(supabase, accountId, (data ?? []) as AppointmentRow[]) })
  } catch (error) { return appointmentErrorResponse(error) }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireAccountModule('appointments', 'agent')
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 160) : ''
    const startsAt = date(body?.starts_at)
    const endsAt = date(body?.ends_at)
    if (!title || !startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) return NextResponse.json({ error: 'Datos de cita inválidos.' }, { status: 400 })
    const contactId = typeof body?.contact_id === 'string' ? body.contact_id : null
    const assignedAgentId = typeof body?.assigned_agent_id === 'string' ? body.assigned_agent_id : userId
    const [contactResult, agentResult] = await Promise.all([
      contactId ? supabase.from('contacts').select('id').eq('id', contactId).eq('account_id', accountId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      supabase.from('profiles').select('user_id').eq('user_id', assignedAgentId).eq('account_id', accountId).eq('is_active', true).maybeSingle(),
    ])
    if (contactResult.error) throw contactResult.error
    if (agentResult.error) throw agentResult.error
    if (contactId && !contactResult.data) return NextResponse.json({ error: 'El contacto no pertenece a esta cuenta.' }, { status: 400 })
    if (!agentResult.data) return NextResponse.json({ error: 'El responsable no está activo en esta cuenta.' }, { status: 400 })
    const { data, error } = await supabase.from('appointments').insert({
      account_id: accountId, created_by: userId, title, starts_at: startsAt, ends_at: endsAt,
      contact_id: contactId,
      assigned_agent_id: assignedAgentId,
      notes: typeof body?.notes === 'string' ? body.notes.trim().slice(0, 2000) || null : null,
      timezone: typeof body?.timezone === 'string' ? body.timezone.slice(0, 80) : 'UTC',
    }).select('id, title, notes, starts_at, ends_at, timezone, status, google_calendar_event_id, google_sync_status, google_sync_error, assigned_agent_id, contact:contacts(name, phone)').single()
    if (error) throw error
    await syncGoogleAppointment(accountId, data).catch(async (syncError) => {
      console.error('[appointments] Google Calendar sync failed:', syncError)
      await supabase.from('appointments').update({ google_sync_status: 'failed', google_sync_error: syncError instanceof Error ? syncError.message.slice(0, 500) : 'Error desconocido de Google Calendar.' }).eq('id', data.id).eq('account_id', accountId)
    })
    const [appointment] = await withAgents(supabase, accountId, [data as AppointmentRow])
    return NextResponse.json({ appointment }, { status: 201 })
  } catch (error) { return appointmentErrorResponse(error) }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireAccountModule('appointments', 'agent')
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const id = typeof body?.id === 'string' ? body.id : ''
    const status = typeof body?.status === 'string' && (STATUSES as readonly string[]).includes(body.status) ? body.status : null
    if (!id) return NextResponse.json({ error: 'Actualización inválida.' }, { status: 400 })
    const startsAt = body?.starts_at === undefined ? undefined : date(body.starts_at)
    const endsAt = body?.ends_at === undefined ? undefined : date(body.ends_at)
    if ((body?.starts_at !== undefined && !startsAt) || (body?.ends_at !== undefined && !endsAt)) return NextResponse.json({ error: 'Fecha u hora inválida.' }, { status: 400 })
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) return NextResponse.json({ error: 'La hora final debe ser posterior a la inicial.' }, { status: 400 })
    const update: Record<string, unknown> = {}
    if (status) update.status = status
    if (typeof body?.title === 'string' && body.title.trim()) update.title = body.title.trim().slice(0, 160)
    if (typeof body?.notes === 'string') update.notes = body.notes.trim().slice(0, 2000) || null
    if (startsAt) update.starts_at = startsAt
    if (endsAt) update.ends_at = endsAt
    if (typeof body?.timezone === 'string') update.timezone = body.timezone.slice(0, 80)
    if (typeof body?.contact_id === 'string' || body?.contact_id === null) {
      if (typeof body.contact_id === 'string') {
        const { data: contact, error } = await supabase.from('contacts').select('id').eq('id', body.contact_id).eq('account_id', accountId).maybeSingle()
        if (error) throw error
        if (!contact) return NextResponse.json({ error: 'El contacto no pertenece a esta cuenta.' }, { status: 400 })
      }
      update.contact_id = body.contact_id
    }
    if (typeof body?.assigned_agent_id === 'string') {
      const { data: member, error } = await supabase.from('profiles').select('user_id').eq('user_id', body.assigned_agent_id).eq('account_id', accountId).eq('is_active', true).maybeSingle()
      if (error) throw error
      if (!member) return NextResponse.json({ error: 'El responsable no está activo en esta cuenta.' }, { status: 400 })
      update.assigned_agent_id = body.assigned_agent_id
    }
    if (!Object.keys(update).length) return NextResponse.json({ error: 'No hay cambios para guardar.' }, { status: 400 })
    const { data, error } = await supabase.from('appointments').update(update).eq('id', id).eq('account_id', accountId).select('id, title, notes, starts_at, ends_at, timezone, status, google_calendar_event_id, assigned_agent_id, contact:contacts(name, phone)').maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'La cita no existe.' }, { status: 404 })
    await syncGoogleAppointment(accountId, data).catch(async (syncError) => {
      console.error('[appointments] Google Calendar sync failed:', syncError)
      await supabase.from('appointments').update({ google_sync_status: 'failed', google_sync_error: syncError instanceof Error ? syncError.message.slice(0, 500) : 'Error desconocido de Google Calendar.' }).eq('id', data.id).eq('account_id', accountId)
    })
    return NextResponse.json({ success: true })
  } catch (error) { return appointmentErrorResponse(error) }
}