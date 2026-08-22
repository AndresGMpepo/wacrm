import { NextResponse } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'

const MODES = ['commercial', 'support', 'services', 'hybrid'] as const
const MODULES = ['pipelines', 'appointments'] as const
type OperatingMode = (typeof MODES)[number]
type AccountModule = (typeof MODULES)[number]

function isOperatingMode(value: unknown): value is OperatingMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value)
}

function modules(value: unknown): AccountModule[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !(MODULES as readonly string[]).includes(item))) return null
  return [...new Set(value)] as AccountModule[]
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const { data, error } = await ctx.supabase
      .from('accounts')
      .select('operating_mode, enabled_modules')
      .eq('id', ctx.accountId)
      .single()

    if (error) throw error
    return NextResponse.json({ operating_mode: data.operating_mode ?? 'hybrid', enabled_modules: data.enabled_modules ?? ['pipelines'], role: ctx.role })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`admin:operating-mode:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null) as { operating_mode?: unknown; enabled_modules?: unknown } | null
    const enabledModules = modules(body?.enabled_modules)
    if (!isOperatingMode(body?.operating_mode) || !enabledModules) {
      return NextResponse.json({ error: 'El perfil operativo no es válido.' }, { status: 400 })
    }

    const { data, error } = await ctx.supabase
      .from('accounts')
      .update({ operating_mode: body.operating_mode, enabled_modules: enabledModules })
      .eq('id', ctx.accountId)
      .select('operating_mode, enabled_modules')
      .single()

    if (error) throw error
    return NextResponse.json({ operating_mode: data.operating_mode, enabled_modules: data.enabled_modules })
  } catch (error) {
    return toErrorResponse(error)
  }
}
