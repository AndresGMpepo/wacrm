import { NextResponse } from 'next/server'

import { requireAccountModule } from '@/lib/account/modules'
import { toErrorResponse } from '@/lib/auth/account'
import { getAgendaProStatusColors, saveAgendaProStatusColors } from '@/lib/agendapro/server'

/**
 * Calendar status-color overrides (see migration 135 and
 * src/lib/agendapro/status-colors.ts). `GET` also returns the distinct
 * status_name values seen in the local agendapro_bookings cache, so
 * the Settings UI can suggest real statuses instead of asking the
 * admin to type them blind — the cache is best-effort (webhook-driven),
 * so the UI also accepts a free-text status to cover anything missing.
 */

export async function GET() {
  try {
    const { supabase, accountId } = await requireAccountModule('agendapro', 'admin')
    const colors = await getAgendaProStatusColors(supabase, accountId)
    const { data } = await supabase
      .from('agendapro_bookings')
      .select('status_name')
      .eq('account_id', accountId)
      .not('status_name', 'is', null)
      .order('synced_at', { ascending: false })
      .limit(500)
    const seen = new Set<string>()
    for (const row of data ?? []) {
      if (row.status_name) seen.add(row.status_name as string)
    }
    return NextResponse.json({ colors, suggested_statuses: Array.from(seen).sort() })
  } catch (error) { return toErrorResponse(error) }
}

export async function POST(request: Request) {
  try {
    const { accountId } = await requireAccountModule('agendapro', 'admin')
    const body = await request.json().catch(() => null) as { colors?: unknown } | null
    const colors = body?.colors
    if (!colors || typeof colors !== 'object' || Array.isArray(colors)) {
      return NextResponse.json({ error: "Falta el mapa 'colors'." }, { status: 400 })
    }
    const entries = Object.entries(colors as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    )
    await saveAgendaProStatusColors(accountId, Object.fromEntries(entries))
    return NextResponse.json({ ok: true })
  } catch (error) { return toErrorResponse(error) }
}
