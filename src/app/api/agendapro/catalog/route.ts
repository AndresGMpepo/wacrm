import { NextResponse } from 'next/server'

import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'
import { listAgendaProLocations, listAgendaProProviders, listAgendaProProducts, listAgendaProServices } from '@/lib/agendapro/server'

const RESOURCES = ['locations', 'services', 'providers', 'products'] as const

export async function GET(request: Request) {
  try {
    const { accountId } = await requireAccountModule('agendapro', 'agent')
    const url = new URL(request.url)
    const resource = url.searchParams.get('resource')
    if (!resource || !(RESOURCES as readonly string[]).includes(resource)) {
      return NextResponse.json({ error: `Indica un recurso válido: ${RESOURCES.join(', ')}.` }, { status: 400 })
    }
    const page = url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined
    const result = await (
      resource === 'locations' ? listAgendaProLocations(accountId, { page }) :
      resource === 'services' ? listAgendaProServices(accountId, { provider_id: url.searchParams.get('provider_id') ? Number(url.searchParams.get('provider_id')) : undefined, page }) :
      resource === 'providers' ? listAgendaProProviders(accountId, { location_ids: url.searchParams.get('location_ids') || undefined, page }) :
      listAgendaProProducts(accountId, { search: url.searchParams.get('search') || undefined, page })
    )
    return NextResponse.json(result)
  } catch (error) { return toErrorResponse(error) }
}
