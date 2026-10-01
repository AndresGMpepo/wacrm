import { NextResponse } from 'next/server'

import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'
import { createAgendaProBooking, createAgendaProClient, cacheAgendaProBooking, listAgendaProBookings } from '@/lib/agendapro/server'

async function resolveAgendaProClientId(supabase: Awaited<ReturnType<typeof requireAccountModule>>['supabase'], accountId: string, contactId: string): Promise<string> {
  const { data: mapped, error: mappedError } = await supabase.from('agendapro_clients')
    .select('agendapro_client_id').eq('account_id', accountId).eq('contact_id', contactId).maybeSingle()
  if (mappedError) throw mappedError
  if (mapped?.agendapro_client_id) return mapped.agendapro_client_id as string

  const { data: contact, error: contactError } = await supabase.from('contacts')
    .select('name, phone, email').eq('id', contactId).eq('account_id', accountId).maybeSingle()
  if (contactError) throw contactError
  if (!contact) throw new Error('No se encontró el contacto.')

  const [firstName, ...rest] = (contact.name || 'Cliente').trim().split(/\s+/)
  const created = await createAgendaProClient(accountId, {
    first_name: firstName || 'Cliente',
    last_name: rest.join(' ') || undefined,
    email: contact.email || undefined,
    phone: contact.phone || undefined,
  })
  const agendaproClientId = String((created as { id?: unknown }).id ?? '')
  if (!agendaproClientId) throw new Error('AgendaPro no devolvió un identificador de cliente.')

  const { error: upsertError } = await supabase.from('agendapro_clients').upsert({
    account_id: accountId, contact_id: contactId, agendapro_client_id: agendaproClientId, synced_at: new Date().toISOString(),
  }, { onConflict: 'account_id,agendapro_client_id' })
  if (upsertError) throw upsertError
  return agendaproClientId
}

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireAccountModule('agendapro', 'agent')
    const url = new URL(request.url)
    const contactId = url.searchParams.get('contact_id')
    let clientId: number | undefined
    if (contactId) {
      const { data: mapped } = await supabase.from('agendapro_clients')
        .select('agendapro_client_id').eq('account_id', accountId).eq('contact_id', contactId).maybeSingle()
      if (mapped?.agendapro_client_id) clientId = Number(mapped.agendapro_client_id)
    }
    const locationId = url.searchParams.get('location_id')
    const serviceId = url.searchParams.get('service_id')
    const providerId = url.searchParams.get('service_provider_id')
    if (!clientId && !locationId && !serviceId && !providerId) {
      return NextResponse.json({ error: 'Indica un contacto, local, servicio o prestador para filtrar.' }, { status: 400 })
    }
    const result = await listAgendaProBookings(accountId, {
      client_id: clientId,
      location_id: locationId ? Number(locationId) : undefined,
      service_id: serviceId ? Number(serviceId) : undefined,
      service_provider_id: providerId ? Number(providerId) : undefined,
      start_date: url.searchParams.get('start_date') || undefined,
      end_date: url.searchParams.get('end_date') || undefined,
      page: url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined,
    })
    return NextResponse.json(result)
  } catch (error) { return toErrorResponse(error) }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireAccountModule('agendapro', 'agent')
    const body = await request.json().catch(() => null) as {
      contact_id?: unknown; location_id?: unknown; service_id?: unknown; provider_id?: unknown
      start_time?: unknown; end_time?: unknown; status_id?: unknown; price?: unknown; notes?: unknown
    } | null
    const contactId = typeof body?.contact_id === 'string' ? body.contact_id : ''
    const locationId = Number(body?.location_id)
    const serviceId = Number(body?.service_id)
    const providerId = Number(body?.provider_id)
    const startTime = typeof body?.start_time === 'string' ? body.start_time : ''
    if (!contactId || !locationId || !serviceId || !providerId || !startTime) {
      return NextResponse.json({ error: 'Faltan datos obligatorios para crear la reserva.' }, { status: 400 })
    }

    const agendaproClientId = await resolveAgendaProClientId(supabase, accountId, contactId)
    const created = await createAgendaProBooking(accountId, {
      start_time: startTime,
      end_time: typeof body?.end_time === 'string' ? body.end_time : undefined,
      service_id: serviceId,
      provider_id: providerId,
      client_id: Number(agendaproClientId),
      location_id: locationId,
      status_id: typeof body?.status_id === 'number' ? body.status_id : 1,
      price: typeof body?.price === 'string' ? body.price : undefined,
      notes: typeof body?.notes === 'string' ? body.notes : undefined,
    })
    await cacheAgendaProBooking(supabase, accountId, contactId, created)
    return NextResponse.json({ booking: created }, { status: 201 })
  } catch (error) { return toErrorResponse(error) }
}
