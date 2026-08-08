import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { toErrorResponse } from '@/lib/auth/account'
import { requirePlatformOperator } from '@/lib/platform/operator'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MEMBER_ROLES = ['admin', 'agent', 'viewer'] as const

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase server configuration')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

function appUrl() {
  const url = process.env.NEXT_PUBLIC_SITE_URL
  if (!url) throw new Error('Missing NEXT_PUBLIC_SITE_URL')
  return url.replace(/\/$/, '')
}

export async function POST(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  try {
    const operator = await requirePlatformOperator()
    const limit = checkRateLimit(`platform:member-create:${operator.user.id}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { accountId } = await params
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const fullName = typeof body?.full_name === 'string' ? body.full_name.trim() : ''
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const role = typeof body?.role === 'string' ? body.role : ''
    if (!fullName || fullName.length > 120) return NextResponse.json({ error: 'Indica un nombre de hasta 120 caracteres.' }, { status: 400 })
    if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Indica un correo válido.' }, { status: 400 })
    if (!(MEMBER_ROLES as readonly string[]).includes(role)) return NextResponse.json({ error: 'Selecciona un rol de equipo válido.' }, { status: 400 })

    const admin = adminClient()
    const [{ data: subscription, error: subscriptionError }, { count, error: countError }] = await Promise.all([
      admin.from('account_subscriptions').select('seat_limit, status, ends_at').eq('account_id', accountId).maybeSingle(),
      admin.from('profiles').select('*', { count: 'exact', head: true }).eq('account_id', accountId),
    ])
    if (subscriptionError || countError) throw subscriptionError ?? countError
    if (!subscription) return NextResponse.json({ error: 'La cuenta no existe o no tiene un plan.' }, { status: 404 })
    if (!['active', 'trial'].includes(subscription.status) || (subscription.ends_at && new Date(subscription.ends_at).getTime() <= Date.now())) {
      return NextResponse.json({ error: 'No se pueden crear usuarios mientras el servicio está pausado o vencido.' }, { status: 409 })
    }
    if ((count ?? 0) >= subscription.seat_limit) return NextResponse.json({ error: `Se alcanzó el límite contratado de ${subscription.seat_limit} usuario(s).` }, { status: 409 })

    const { data: invitation, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, platform_provisioned: true },
      redirectTo: `${appUrl()}/set-password`,
    })
    if (inviteError || !invitation.user) return NextResponse.json({ error: inviteError?.message ?? 'No se pudo enviar la invitación.' }, { status: 400 })

    const { error: profileError } = await admin.from('profiles').insert({
      user_id: invitation.user.id,
      full_name: fullName,
      email,
      account_id: accountId,
      account_role: role,
      is_active: true,
    })
    if (profileError) {
      await admin.auth.admin.deleteUser(invitation.user.id)
      throw profileError
    }
    return NextResponse.json({ message: 'Usuario creado e invitado. Definirá su contraseña desde el correo.' }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
