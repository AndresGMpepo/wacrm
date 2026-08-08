import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { toErrorResponse } from '@/lib/auth/account'
import { PLAN_CODES } from '@/lib/account/entitlements'
import { requirePlatformOperator } from '@/lib/platform/operator'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'

const MAX_ACCOUNT_NAME = 80
const SUBSCRIPTION_STATUSES = ['active', 'trial', 'suspended', 'cancelled'] as const

function parseEndDate(value: unknown) {
  if (value === '' || value === null || value === undefined) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const date = new Date(`${value}T23:59:59.999Z`)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase server configuration')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  try {
    const operator = await requirePlatformOperator()
    const limit = checkRateLimit(`platform:account-update:${operator.user.id}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { accountId } = await params
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const name = typeof body?.account_name === 'string' ? body.account_name.trim() : ''
    const planCode = typeof body?.plan_code === 'string' ? body.plan_code : ''
    const seatLimit = typeof body?.seat_limit === 'number' ? body.seat_limit : Number(body?.seat_limit)
    const status = typeof body?.status === 'string' ? body.status : ''
    const endsAt = parseEndDate(body?.ends_at)
    if (!name || name.length > MAX_ACCOUNT_NAME) return NextResponse.json({ error: 'Indica un nombre comercial de hasta 80 caracteres.' }, { status: 400 })
    if (!(PLAN_CODES as readonly string[]).includes(planCode)) return NextResponse.json({ error: 'El plan seleccionado no es válido.' }, { status: 400 })
    if (!Number.isInteger(seatLimit) || seatLimit < 1 || seatLimit > 1000) return NextResponse.json({ error: 'Los usuarios contratados deben estar entre 1 y 1000.' }, { status: 400 })
    if (!(SUBSCRIPTION_STATUSES as readonly string[]).includes(status)) return NextResponse.json({ error: 'El estado seleccionado no es válido.' }, { status: 400 })
    if (endsAt === undefined) return NextResponse.json({ error: 'La fecha de finalización no es válida.' }, { status: 400 })

    const admin = adminClient()
    const { count, error: countError } = await admin.from('profiles').select('*', { count: 'exact', head: true }).eq('account_id', accountId)
    if (countError) throw countError
    if ((count ?? 0) > seatLimit) return NextResponse.json({ error: `No puedes bajar el límite a ${seatLimit}: la cuenta ya tiene ${count} usuario(s).` }, { status: 400 })

    const { error: accountError } = await admin.from('accounts').update({ name }).eq('id', accountId)
    if (accountError) throw accountError
    const { error: subscriptionError } = await admin.from('account_subscriptions').update({ plan_code: planCode, seat_limit: seatLimit, status, ends_at: endsAt }).eq('account_id', accountId)
    if (subscriptionError) throw subscriptionError
    return NextResponse.json({ message: 'Plan y límite de usuarios actualizados.' })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  try {
    const operator = await requirePlatformOperator()
    const limit = checkRateLimit(`platform:account-delete:${operator.user.id}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { accountId } = await params
    const admin = adminClient()
    const { data: account, error: accountError } = await admin.from('accounts').select('id, owner_user_id').eq('id', accountId).maybeSingle()
    if (accountError) throw accountError
    if (!account) return NextResponse.json({ error: 'La cuenta ya no existe.' }, { status: 404 })
    if (account.owner_user_id === operator.user.id) {
      return NextResponse.json({ error: 'No puedes borrar la cuenta desde la que estás operando la plataforma.' }, { status: 409 })
    }

    const { count, error: countError } = await admin.from('profiles').select('*', { count: 'exact', head: true }).eq('account_id', accountId)
    if (countError) throw countError
    if (count !== 1) return NextResponse.json({ error: 'Por seguridad, sólo se puede borrar una cuenta de prueba con exactamente un propietario. Primero resuelve los miembros adicionales o la inconsistencia de perfiles.' }, { status: 409 })

    // Account deletion cascades tenant data and the owner profile. Only then can
    // Auth remove the owner: accounts.owner_user_id uses ON DELETE RESTRICT.
    const { error: deleteAccountError } = await admin.from('accounts').delete().eq('id', accountId)
    if (deleteAccountError) throw deleteAccountError
    const { error: deleteUserError } = await admin.auth.admin.deleteUser(account.owner_user_id)
    if (deleteUserError) {
      console.error('[DELETE /api/platform/accounts/[accountId]] auth cleanup failed:', deleteUserError)
      return NextResponse.json({ error: 'La cuenta fue eliminada, pero no se pudo borrar el usuario de Auth. Revísalo en Supabase Auth antes de reutilizar el correo.' }, { status: 500 })
    }
    return NextResponse.json({ message: 'Cuenta de prueba y acceso del propietario eliminados.' })
  } catch (error) {
    return toErrorResponse(error)
  }
}
