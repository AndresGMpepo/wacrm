import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js'

import { ForbiddenError } from '@/lib/auth/account'

/**
 * Time-boxed support access to a customer account.
 *
 * A platform operator manages the commercial record without ever seeing the
 * tenant's data. To actually help, they open a support session: they state a
 * reason, it expires on its own, and every read is written to the operator
 * audit trail. No standing back door, and the customer's account keeps a
 * record of who looked and why.
 */

export const DEFAULT_SUPPORT_MINUTES = 60
export const MAX_SUPPORT_MINUTES = 480

export interface SupportSession {
  id: string
  account_id: string
  operator_email: string
  reason: string
  expires_at: string
  created_at: string
}

export function supportAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase server configuration')
  return createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

/** Operator actions on a tenant share the existing commercial audit trail. */
export async function logSupportAudit(
  db: SupabaseClient,
  args: { accountId: string; accountName: string; actorUserId: string; action: string; details?: Record<string, unknown> },
): Promise<void> {
  const { error } = await db.from('platform_commercial_audit').insert({
    account_id: args.accountId,
    account_name: args.accountName,
    actor_user_id: args.actorUserId,
    action: args.action,
    details: args.details ?? {},
  })
  if (error) console.error('[platform support] could not write audit row:', error.message)
}

export async function getActiveSupportSession(
  db: SupabaseClient,
  accountId: string,
  operatorEmail: string,
): Promise<SupportSession | null> {
  const { data, error } = await db
    .from('platform_support_sessions')
    .select('id, account_id, operator_email, reason, expires_at, created_at')
    .eq('account_id', accountId)
    .eq('operator_email', operatorEmail.toLowerCase())
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as SupportSession | null) ?? null
}

export async function startSupportSession(
  db: SupabaseClient,
  args: { accountId: string; operatorUserId: string; operatorEmail: string; reason: string; minutes: number },
): Promise<SupportSession> {
  const minutes = Math.min(MAX_SUPPORT_MINUTES, Math.max(5, Math.floor(args.minutes) || DEFAULT_SUPPORT_MINUTES))
  const { data, error } = await db
    .from('platform_support_sessions')
    .insert({
      account_id: args.accountId,
      operator_user_id: args.operatorUserId,
      operator_email: args.operatorEmail.toLowerCase(),
      reason: args.reason,
      expires_at: new Date(Date.now() + minutes * 60_000).toISOString(),
    })
    .select('id, account_id, operator_email, reason, expires_at, created_at')
    .single()
  if (error) throw error
  return data as SupportSession
}

export async function endSupportSessions(
  db: SupabaseClient,
  accountId: string,
  operatorEmail: string,
): Promise<number> {
  const { data, error } = await db
    .from('platform_support_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('account_id', accountId)
    .eq('operator_email', operatorEmail.toLowerCase())
    .is('revoked_at', null)
    .select('id')
  if (error) throw error
  return data?.length ?? 0
}

/**
 * Gate for every read of tenant data. Without a live session the operator
 * gets the same answer as anyone else: no.
 */
export async function requireSupportSession(
  db: SupabaseClient,
  accountId: string,
  operatorEmail: string | null | undefined,
): Promise<SupportSession> {
  if (!operatorEmail) throw new ForbiddenError('No hay una sesión de soporte activa.')
  const session = await getActiveSupportSession(db, accountId, operatorEmail)
  if (!session) {
    throw new ForbiddenError('Inicia una sesión de soporte para revisar esta cuenta.')
  }
  return session
}
