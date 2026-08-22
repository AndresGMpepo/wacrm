import { NextResponse } from 'next/server'
import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'

const STATUSES = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'] as const

function date(value: unknown) {
  if (typeof value !== 'string') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireAccountModule('appointments')
    const url = new URL(request.url)
    const from = date(url.searchParams.get('from')) ?? new Date(Date.now() - 7 * 86_400_000).toISOString()
    const to = date(url.searchParams.get('to')) ?? new Date(Date.now() + 30 * 86_400_000).toISOString()
    const { data, error } = await supabase.from('appointments')
      .select('id, contact_id, assigned_agent_id, title, notes, starts_at, ends_at, timezone, status, created_at, contact:contacts(name, phone), agent:profiles!appointments_assigned_agent_id_fkey(full_name)')
      .eq('account_id', accountId).gte('starts_at', from).lt('starts_at', to).order('starts_at')
    if (error) throw error
    return NextResponse.json({ appointments: data ?? [] })
  } catch (error) { return toErrorResponse(error) }
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
    }).select('id').single()
    if (error) throw error
    return NextResponse.json({ appointment: data }, { status: 201 })
  } catch (error) { return toErrorResponse(error) }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireAccountModule('appointments', 'agent')
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const id = typeof body?.id === 'string' ? body.id : ''
    const status = typeof body?.status === 'string' && (STATUSES as readonly string[]).includes(body.status) ? body.status : null
    if (!id || !status) return NextResponse.json({ error: 'Actualización inválida.' }, { status: 400 })
    const { error } = await supabase.from('appointments').update({ status }).eq('id', id).eq('account_id', accountId)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) { return toErrorResponse(error) }
}