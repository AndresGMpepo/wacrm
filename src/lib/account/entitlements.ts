import type { SupabaseClient } from '@supabase/supabase-js'

import { ForbiddenError, requireRole, type AccountContext } from '@/lib/auth/account'
import type { AccountRole } from '@/lib/auth/roles'

export const PLAN_CODES = ['ai', 'yeastar_voice', 'whatsapp_voice'] as const
export type PlanCode = (typeof PLAN_CODES)[number]

export const ENTITLEMENTS = [
  'ai_conversation_intelligence',
  'yeastar_telephony',
  'yeastar_live_chat',
  'whatsapp_voice_calls',
] as const
export type Entitlement = (typeof ENTITLEMENTS)[number]

type SubscriptionRow = {
  plan_code: string
  seat_limit: number
  status: string
  feature_overrides: Record<string, unknown> | null
}

export type AccountEntitlements = {
  planCode: PlanCode
  seatLimit: number
  status: 'active' | 'trial' | 'suspended' | 'cancelled'
  features: Record<Entitlement, boolean>
}

const PLAN_FEATURES: Record<PlanCode, Record<Entitlement, boolean>> = {
  ai: { ai_conversation_intelligence: true, yeastar_telephony: false, yeastar_live_chat: false, whatsapp_voice_calls: false },
  yeastar_voice: { ai_conversation_intelligence: true, yeastar_telephony: true, yeastar_live_chat: true, whatsapp_voice_calls: false },
  whatsapp_voice: { ai_conversation_intelligence: true, yeastar_telephony: true, yeastar_live_chat: true, whatsapp_voice_calls: true },
}

function isPlanCode(value: string): value is PlanCode {
  return (PLAN_CODES as readonly string[]).includes(value)
}

function isSubscriptionStatus(value: string): value is AccountEntitlements['status'] {
  return value === 'active' || value === 'trial' || value === 'suspended' || value === 'cancelled'
}

/** Server-side source of truth. UI visibility is never an authorization boundary. */
export async function getAccountEntitlements(supabase: SupabaseClient, accountId: string): Promise<AccountEntitlements | null> {
  const { data, error } = await supabase
    .from('account_subscriptions')
    .select('plan_code, seat_limit, status, feature_overrides')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const row = data as SubscriptionRow
  const planCode = row.plan_code
  const status = row.status
  if (!isPlanCode(planCode) || !isSubscriptionStatus(status)) return null
  const enabled = status === 'active' || status === 'trial'
  const features = Object.fromEntries(ENTITLEMENTS.map((feature) => {
    const override = row.feature_overrides?.[feature]
    return [feature, enabled && (typeof override === 'boolean' ? override : PLAN_FEATURES[planCode][feature])]
  })) as Record<Entitlement, boolean>

  return { planCode, seatLimit: row.seat_limit, status, features }
}

/**
 * Server guard for a billable module. Add it to every route that starts,
 * configures, or exposes that module; client-side feature flags are cosmetic.
 */
export async function requireEntitlement(
  feature: Entitlement,
  minRole: AccountRole = 'viewer',
): Promise<AccountContext & { entitlements: AccountEntitlements }> {
  const ctx = await requireRole(minRole)
  const entitlements = await getAccountEntitlements(ctx.supabase, ctx.accountId)
  if (!entitlements?.features[feature]) {
    throw new ForbiddenError('Esta función no está incluida en el plan activo de la cuenta.')
  }
  return { ...ctx, entitlements }
}
