import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'

const MAX_DAYS = 90

type ActivityRow = {
  id: string
  actor_user_id: string | null
  action: string
  entity_type: string
  conversation_id: string | null
  contact_id: string | null
  details: Record<string, unknown>
  created_at: string
}

function csvCell(value: string | null): string {
  const raw = value ?? ''
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw
  return `"${safe.replace(/"/g, '""')}"`
}

/**
 * GET /api/supervision/activity  (admin+)
 *
 * Everything the team did: closes, reopens, assignments, AI takeovers,
 * tags, notes, deals and appointments. Rows with no actor were done by the
 * system (automation, AI, routing), which is how a supervisor tells the two
 * apart. `?format=csv` downloads the window.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const url = new URL(request.url)

    const days = Math.min(MAX_DAYS, Math.max(1, Number(url.searchParams.get('days')) || 7))
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 200))
    const since = new Date(Date.now() - days * 86_400_000).toISOString()

    let query = supabase
      .from('agent_activity_log')
      .select('id, actor_user_id, action, entity_type, conversation_id, contact_id, details, created_at')
      .eq('account_id', accountId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(limit)

    const actor = url.searchParams.get('agent')
    if (actor) query = query.eq('actor_user_id', actor)
    const action = url.searchParams.get('action')
    if (action) query = query.eq('action', action)

    const { data, error } = await query
    if (error) throw error
    const rows = (data ?? []) as ActivityRow[]

    const [profiles, contacts] = await Promise.all([
      supabase.from('profiles').select('user_id, full_name, email').eq('account_id', accountId),
      rows.some((row) => row.contact_id)
        ? supabase
            .from('contacts')
            .select('id, name, phone')
            .in('id', [...new Set(rows.map((row) => row.contact_id).filter(Boolean) as string[])])
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ])

    const agentName = new Map<string, string>()
    for (const profile of profiles.data ?? []) {
      agentName.set(
        profile.user_id as string,
        (profile.full_name as string) || (profile.email as string) || (profile.user_id as string),
      )
    }
    const contactName = new Map<string, string>()
    for (const contact of contacts.data ?? []) {
      contactName.set(contact.id as string, ((contact.name as string) || (contact.phone as string) || 'Contacto') as string)
    }

    const events = rows.map((row) => ({
      ...row,
      agent: row.actor_user_id ? agentName.get(row.actor_user_id) ?? row.actor_user_id : null,
      contact: row.contact_id ? contactName.get(row.contact_id) ?? null : null,
    }))

    if (url.searchParams.get('format') === 'csv') {
      const header = ['fecha', 'agente', 'accion', 'entidad', 'contacto', 'detalle']
      const body = events.map((event) =>
        [
          event.created_at,
          event.agent ?? 'Sistema',
          event.action,
          event.entity_type,
          event.contact,
          JSON.stringify(event.details ?? {}),
        ]
          .map((value) => csvCell(value as string | null))
          .join(','),
      )
      return new NextResponse(`\uFEFF${[header.join(','), ...body].join('\r\n')}`, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="actividad-agentes-${days}d.csv"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    return NextResponse.json({ events, days })
  } catch (error) {
    return toErrorResponse(error)
  }
}
