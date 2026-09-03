import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { toErrorResponse } from '@/lib/auth/account'
import { requirePlatformOperator } from '@/lib/platform/operator'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase server configuration')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

/**
 * DELETE /api/platform/accounts/[accountId]/contacts/[contactId]  (platform operator)
 *
 * The only path that truly destroys a contact — and with it, by FK cascade,
 * its conversations and messages. Inside a tenant the product only archives
 * (`deleted_at`), so an agent or admin can never wipe a customer's history.
 *
 * Requires the contact to be archived first: destroying live data must be a
 * deliberate second step, not a slip.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ accountId: string; contactId: string }> },
) {
  try {
    const operator = await requirePlatformOperator()
    const limit = checkRateLimit(`platform:contact-delete:${operator.user.id}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { accountId, contactId } = await params
    const reason = new URL(request.url).searchParams.get('reason')?.trim().slice(0, 300) || null

    const db = adminClient()
    const { data: contact, error } = await db
      .from('contacts')
      .select('id, name, phone, email, company, deleted_at')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) throw error
    if (!contact) return NextResponse.json({ error: 'El contacto no existe en esta cuenta.' }, { status: 404 })
    if (!contact.deleted_at) {
      return NextResponse.json(
        { error: 'Archiva el contacto antes de eliminarlo definitivamente.' },
        { status: 409 },
      )
    }

    const { count: conversationCount } = await db
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('contact_id', contactId)

    // Written before the delete: the FK sets contact_id to NULL here, and a
    // failed delete leaving an audit row is far better than the reverse.
    const { error: auditError } = await db.from('contact_audit_log').insert({
      account_id: accountId,
      contact_id: contactId,
      actor_user_id: null,
      action: 'deleted',
      reason: reason ?? `Eliminado por el operador ${operator.user.email ?? 'de plataforma'}`,
      snapshot: {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
        operator_email: operator.user.email,
        deleted_conversations: conversationCount ?? 0,
      },
    })
    if (auditError) throw auditError

    const { error: deleteError } = await db.from('contacts').delete().eq('id', contactId).eq('account_id', accountId)
    if (deleteError) throw deleteError

    return NextResponse.json({ deleted: true, conversations_removed: conversationCount ?? 0 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
