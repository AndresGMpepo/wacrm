import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { buildContactTrace, contactTraceCsv } from '@/lib/contacts/trace'

/**
 * GET /api/contacts/[id]/trace  (agent+)
 *
 * Full traceability for one customer: conversations opened, every
 * assignment and reassignment, which agents actually replied, phone calls
 * and archive/restore actions. `?format=csv` downloads the same list.
 *
 * Reads through the caller's RLS-scoped client, so a contact outside the
 * account simply isn't found.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { id } = await params

    const { data: contact, error } = await supabase
      .from('contacts')
      .select('id, name, phone')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) throw error
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

    const events = await buildContactTrace(supabase, accountId, id)

    if (new URL(request.url).searchParams.get('format') === 'csv') {
      const label = (contact.name || contact.phone || id).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60)
      return new NextResponse(`\uFEFF${contactTraceCsv(events)}`, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="trazabilidad-${label}.csv"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    return NextResponse.json({ contact, events })
  } catch (error) {
    return toErrorResponse(error)
  }
}
