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
 * Global message-retention policy — deliberately platform-wide (one row,
 * `platform_settings.id = true`) and only ever reachable from this
 * operator-gated route, never surfaced in tenant Settings. Applied by
 * the `/api/internal/message-retention` cron via `purge_old_messages()`
 * (migration 121).
 */
export async function GET() {
  try {
    await requirePlatformOperator()
    const admin = adminClient()
    const { data, error } = await admin.from('platform_settings').select('message_retention_days, updated_at').eq('id', true).maybeSingle()
    if (error) throw error
    return NextResponse.json({ message_retention_days: data?.message_retention_days ?? null, updated_at: data?.updated_at ?? null })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const operator = await requirePlatformOperator()
    const limit = checkRateLimit(`platform:retention-update:${operator.user.id}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const raw = body?.message_retention_days
    let days: number | null
    if (raw === null || raw === '' || raw === undefined) {
      days = null
    } else {
      days = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isInteger(days) || days < 30 || days > 3650) {
        return NextResponse.json({ error: 'La retención debe ser nula (desactivada) o estar entre 30 y 3650 días.' }, { status: 400 })
      }
    }

    const admin = adminClient()
    const { error } = await admin.from('platform_settings').update({
      message_retention_days: days,
      updated_by: operator.user.id,
      updated_at: new Date().toISOString(),
    }).eq('id', true)
    if (error) throw error

    return NextResponse.json({ message: days ? `Los mensajes se borrarán automáticamente después de ${days} días.` : 'Retención automática desactivada.', message_retention_days: days })
  } catch (error) {
    return toErrorResponse(error)
  }
}
