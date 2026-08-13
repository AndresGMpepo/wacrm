import { NextResponse } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'

const MODES = ['commercial', 'support', 'hybrid'] as const
type OperatingMode = (typeof MODES)[number]

function isOperatingMode(value: unknown): value is OperatingMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value)
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const { data, error } = await ctx.supabase
      .from('accounts')
      .select('operating_mode')
      .eq('id', ctx.accountId)
      .single()

    if (error) throw error
    return NextResponse.json({ operating_mode: data.operating_mode ?? 'hybrid', role: ctx.role })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`admin:operating-mode:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null) as { operating_mode?: unknown } | null
    if (!isOperatingMode(body?.operating_mode)) {
      return NextResponse.json({ error: 'El perfil operativo no es válido.' }, { status: 400 })
    }

    const { data, error } = await ctx.supabase
      .from('accounts')
      .update({ operating_mode: body.operating_mode })
      .eq('id', ctx.accountId)
      .select('operating_mode')
      .single()

    if (error) throw error
    return NextResponse.json({ operating_mode: data.operating_mode })
  } catch (error) {
    return toErrorResponse(error)
  }
}
