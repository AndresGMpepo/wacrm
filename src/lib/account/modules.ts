import { ForbiddenError, requireRole, type AccountContext } from '@/lib/auth/account'
import type { AccountRole } from '@/lib/auth/roles'

export const ACCOUNT_MODULES = ['pipelines', 'appointments'] as const
export type AccountModule = (typeof ACCOUNT_MODULES)[number]

export async function requireAccountModule(module: AccountModule, minRole: AccountRole = 'viewer'): Promise<AccountContext> {
  const context = await requireRole(minRole)
  const { data, error } = await context.supabase.from('accounts').select('enabled_modules').eq('id', context.accountId).single()
  if (error) throw error
  const enabled = Array.isArray(data.enabled_modules) ? data.enabled_modules : ['pipelines']
  if (!enabled.includes(module)) throw new ForbiddenError('Este módulo está deshabilitado para la cuenta.')
  return context
}