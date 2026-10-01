import { NextResponse } from 'next/server'

import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'
import { listAvailableSlots } from '@/lib/agendapro/server'

export async function GET(request: Request) {
  try {
    const { accountId } = await requireAccountModule('agendapro', 'agent')
    const url = new URL(request.url)
    const locationId = url.searchParams.get('location_id')
    const startDate = url.searchParams.get('start_date')
    if (!locationId || !startDate) {
      return NextResponse.json({ error: 'Indica el local (location_id) y la fecha (start_date).' }, { status: 400 })
    }
    const serviceId = url.searchParams.get('service_id')
    const providerId = url.searchParams.get('provider_id')
    const result = await listAvailableSlots(accountId, {
      location_id: Number(locationId),
      start_date: startDate,
      service_id: serviceId ? Number(serviceId) : undefined,
      provider_id: providerId ? Number(providerId) : undefined,
    })
    return NextResponse.json(result)
  } catch (error) { return toErrorResponse(error) }
}
