import { NextResponse } from 'next/server'

import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'
import { createAgendaProBooking, listAgendaProBookings } from '@/lib/agendapro/server'

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireAccountModule('agendapro', 'agent')
    const url = new URL(request.url)
    const contactId = url.searchParams.get('contact_id')
    let clients: number[] | undefined
    if (contactId) {
      const { data: mapped } = await supabase.from('agendapro_clients')
        .select('agendapro_client_id').eq('account_id', accountId).eq('contact_id', contactId).maybeSingle()
      if (mapped?.agendapro_client_id) clients = [Number(mapped.agendapro_client_id)]
    }
    const locationId = url.searchParams.get('location_id')
    const serviceId = url.searchParams.get('service_id')
    const providerId = url.searchParams.get('provider_id')
    const result = await listAgendaProBookings(accountId, {
      clients,
      locations: locationId ? [Number(locationId)] : undefined,
      services: serviceId ? [Number(serviceId)] : undefined,
      providers: providerId ? [Number(providerId)] : undefined,
      range_from: url.searchParams.get('range_from') || undefined,
      range_to: url.searchParams.get('range_to') || undefined,
      page: url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined,
    })
    return NextResponse.json(result)
  } catch (error) { return toErrorResponse(error) }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireAccountModule('agendapro', 'agent')
    const body = await request.json().catch(() => null) as {
      contact_id?: unknown; service_id?: unknown; provider_id?: unknown
      start?: unknown; end?: unknown; price?: unknown
    } | null
    const contactId = typeof body?.contact_id === 'string' ? body.contact_id : ''
    const serviceId = Number(body?.service_id)
    const providerId = Number(body?.provider_id)
    const start = typeof body?.start === 'string' ? body.start : ''
    const end = typeof body?.end === 'string' ? body.end : ''
    if (!contactId || !serviceId || !providerId || !start || !end) {
      return NextResponse.json({ error: 'Faltan datos obligatorios para crear la reserva.' }, { status: 400 })
    }

    const { data: contact, error: contactError } = await supabase.from('contacts')
      .select('name, phone, email').eq('id', contactId).eq('account_id', accountId).maybeSingle()
    if (contactError) throw contactError
    if (!contact) return NextResponse.json({ error: 'No se encontró el contacto.' }, { status: 404 })
    const [firstName, ...rest] = (contact.name || 'Cliente').trim().split(/\s+/)

    // AgendaPro V1 creates/matches the client inline with the booking —
    // no separate "create client first" step needed, unlike Connect v3.
    const created = await createAgendaProBooking(accountId, {
      start, end, service_id: serviceId, provider_id: providerId,
      price: typeof body?.price === 'number' ? body.price : undefined,
      first_name: firstName || 'Cliente',
      last_name: rest.join(' ') || undefined,
      email: contact.email || undefined,
      phone: contact.phone || undefined,
    }) as { id: number; client?: { id?: number } }

    if (created.client?.id) {
      await supabase.from('agendapro_clients').upsert({
        account_id: accountId, contact_id: contactId, agendapro_client_id: String(created.client.id), synced_at: new Date().toISOString(),
      }, { onConflict: 'account_id,agendapro_client_id' })
    }
    return NextResponse.json({ booking: created }, { status: 201 })
  } catch (error) { return toErrorResponse(error) }
}

