import { createClient } from '@/lib/supabase/server'
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account'

/**
 * Platform access is deliberately independent from tenant roles. An account
 * owner is not automatically an operator of every customer account.
 *
 * Keep this list server-only (without NEXT_PUBLIC_) in the WACRM service
 * environment, for example:
 * PLATFORM_OPERATOR_EMAILS=andres@your-company.com,ops@your-company.com
 */
function operatorEmails() {
  return new Set(
    (process.env.PLATFORM_OPERATOR_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )
}

export async function requirePlatformOperator() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) throw new UnauthorizedError()

  const allowed = operatorEmails()
  if (allowed.size === 0 || !user.email || !allowed.has(user.email.toLowerCase())) {
    throw new ForbiddenError('No tienes acceso al panel de plataforma.')
  }

  return { supabase, user }
}
