import { NextResponse } from 'next/server'

import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'
import { listAgendaProLocations, listAgendaProProviders, listAgendaProServices } from '@/lib/agendapro/server'

const RESOURCES = ['locations', 'services', 'providers'] as const

export async function GET(request: Request) {
  try {
    const { accountId } = await requireAccountModule('agendapro', 'agent')
    const url = new URL(request.url)
    const resource = url.searchParams.get('resource')
    if (!resource || !(RESOURCES as readonly string[]).includes(resource)) {
      return NextResponse.json({ error: `Indica un recurso válido: ${RESOURCES.join(', ')}.` }, { status: 400 })
    }
    const result = await (
      resource === 'locations' ? listAgendaProLocations(accountId) :
      resource === 'services' ? listAgendaProServices(accountId) :
      listAgendaProProviders(accountId)
    )
    return NextResponse.json(result)
  } catch (error) { return toErrorResponse(error) }
}

