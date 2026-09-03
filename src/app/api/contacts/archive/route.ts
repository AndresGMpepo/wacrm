import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'

const MAX_IDS = 200

/**
 * POST /api/contacts/archive
 *
 * Body: { ids: string[], restore?: boolean, reason?: string }
 *
 * Archiving replaces what used to be a hard DELETE from the contacts list.
 * The contact disappears from lists, pickers and broadcast audiences, but
 * its conversations, messages and history stay exactly where they are —
 * `conversations.contact_id` cascades on delete, so a real DELETE erased
 * the whole customer relationship.
 *
 * Archiving needs `agent`; restoring needs `admin`.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { ids?: unknown; restore?: unknown; reason?: unknown }
      | null
    const restore = body?.restore === true
    const { accountId, userId } = await requireRole(restore ? 'admin' : 'agent')

    const limit = checkRateLimit(`contacts-archive:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, MAX_IDS)
      : []
    if (ids.length === 0) {
      return NextResponse.json({ error: 'Selecciona al menos un contacto.' }, { status: 400 })
    }
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 300) || null : null

    const db = supabaseAdmin()
    // Scope by account before writing: this runs through the service-role
    // client, which bypasses RLS.
    const { data: contacts, error: loadError } = await db
      .from('contacts')
      .select('id, name, phone, email, company, deleted_at')
      .eq('account_id', accountId)
      .in('id', ids)
    if (loadError) throw loadError
    const targets = (contacts ?? []).filter((c) => (restore ? c.deleted_at : !c.deleted_at))
    if (targets.length === 0) {
      return NextResponse.json({ updated: 0 })
    }

    const { error: updateError } = await db
      .from('contacts')
      .update(
        restore
          ? { deleted_at: null, deleted_by: null, updated_at: new Date().toISOString() }
          : { deleted_at: new Date().toISOString(), deleted_by: userId, updated_at: new Date().toISOString() },
      )
      .eq('account_id', accountId)
      .in(
        'id',
        targets.map((c) => c.id),
      )
    if (updateError) throw updateError

    const { error: auditError } = await db.from('contact_audit_log').insert(
      targets.map((contact) => ({
        account_id: accountId,
        contact_id: contact.id,
        actor_user_id: userId,
        action: restore ? 'restored' : 'archived',
        reason,
        snapshot: { name: contact.name, phone: contact.phone, email: contact.email, company: contact.company },
      })),
    )
    if (auditError) console.error('[contacts] could not write audit rows:', auditError.message)

    return NextResponse.json({ updated: targets.length })
  } catch (error) {
    return toErrorResponse(error)
  }
}
