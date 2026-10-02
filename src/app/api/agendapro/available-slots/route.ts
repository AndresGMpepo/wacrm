import { NextResponse } from 'next/server'

import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'
import { listAvailableHours } from '@/lib/agendapro/server'

export async function GET(request: Request) {
  try {
    const { accountId } = await requireAccountModule('agendapro', 'agent')
    const url = new URL(request.url)
    const serviceId = url.searchParams.get('service_id')
    const date = url.searchParams.get('date')
    if (!serviceId || !date) {
      return NextResponse.json({ error: 'Indica el servicio (service_id) y la fecha (date).' }, { status: 400 })
    }
    const providerId = url.searchParams.get('provider_id')
    const locationId = url.searchParams.get('location_id')
    if (!providerId && !locationId) {
      return NextResponse.json({ error: 'Indica un prestador (provider_id) o un local (location_id).' }, { status: 400 })
    }
    const result = await listAvailableHours(accountId, Number(serviceId), {
      date,
      provider_id: providerId ? Number(providerId) : undefined,
      location_id: locationId ? Number(locationId) : undefined,
    })
    return NextResponse.json(result)
  } catch (error) { return toErrorResponse(error) }
}

