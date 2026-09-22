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
 * "Reset for production" button — wipes a tenant's CRM/operational data
 * (contacts, conversations, messages, deals, broadcasts, appointments,
 * notifications, AI/flow/automation run history) via
 * `wipe_tenant_operational_data()` (migration 121). Deliberately does NOT
 * touch the account/subscription/members, connected channels, approved
 * templates, or automation/flow DEFINITIONS — only their test-run data.
 * Only reachable by a platform operator, scoped to exactly one account.
 */
export async function POST(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  try {
    const operator = await requirePlatformOperator()
    const limit = checkRateLimit(`platform:account-wipe:${operator.user.id}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { accountId } = await params
    const admin = adminClient()
    const { data: account, error: accountError } = await admin.from('accounts').select('id, name').eq('id', accountId).maybeSingle()
    if (accountError) throw accountError
    if (!account) return NextResponse.json({ error: 'La cuenta no existe.' }, { status: 404 })

    const { data: summary, error: wipeError } = await admin.rpc('wipe_tenant_operational_data', { p_account_id: accountId })
    if (wipeError) throw wipeError

    const { error: auditError } = await admin.from('platform_commercial_audit').insert({
      account_id: accountId,
      account_name: account.name,
      actor_user_id: operator.user.id,
      action: 'tenant_data_wiped',
      details: { summary },
    })
    if (auditError) throw auditError

    return NextResponse.json({ message: 'Datos operativos de la cuenta eliminados.', summary })
  } catch (error) {
    return toErrorResponse(error)
  }
}
