import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { toErrorResponse } from '@/lib/auth/account'
import { requirePlatformOperator } from '@/lib/platform/operator'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'

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

export async function POST(_request: Request, { params }: { params: Promise<{ accountId: string; memberId: string }> }) {
  try {
    const operator = await requirePlatformOperator()
    const limit = checkRateLimit(`platform:member-invite:${operator.user.id}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { accountId, memberId } = await params
    const admin = adminClient()
    const [{ data: member, error: memberError }, { data: authResult, error: authError }] = await Promise.all([
      admin.from('profiles').select('full_name, email').eq('account_id', accountId).eq('user_id', memberId).maybeSingle(),
      admin.auth.admin.getUserById(memberId),
    ])
    if (memberError || authError) throw memberError ?? authError
    if (!member || !authResult.user) return NextResponse.json({ error: 'El usuario ya no pertenece a esta cuenta.' }, { status: 404 })
    if (authResult.user.email_confirmed_at) return NextResponse.json({ error: 'Este usuario ya activó su acceso. Debe usar “Olvidé mi contraseña” si requiere recuperarlo.' }, { status: 409 })
    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(member.email, {
      data: { full_name: member.full_name ?? '', platform_provisioned: true },
      redirectTo: `${appUrl()}/set-password`,
    })
    if (inviteError) return NextResponse.json({ error: inviteError.message }, { status: 400 })
    return NextResponse.json({ message: 'Invitación reenviada. El enlace anterior deja de ser válido.' })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ accountId: string; memberId: string }> }) {
  try {
    const operator = await requirePlatformOperator()
    const limit = checkRateLimit(`platform:member-update:${operator.user.id}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { accountId, memberId } = await params
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const role = typeof body?.role === 'string' ? body.role : undefined
    const isActive = typeof body?.is_active === 'boolean' ? body.is_active : undefined
    if (role !== undefined && !(MEMBER_ROLES as readonly string[]).includes(role)) return NextResponse.json({ error: 'El rol no es válido.' }, { status: 400 })
    if (role === undefined && isActive === undefined) return NextResponse.json({ error: 'No hay cambios para guardar.' }, { status: 400 })

    const admin = adminClient()
    const { data: member, error: memberError } = await admin.from('profiles').select('user_id, account_role').eq('account_id', accountId).eq('user_id', memberId).maybeSingle()
    if (memberError) throw memberError
    if (!member) return NextResponse.json({ error: 'El usuario ya no pertenece a esta cuenta.' }, { status: 404 })
    if (member.account_role === 'owner') return NextResponse.json({ error: 'El propietario se administra desde la cuenta comercial, no desde los usuarios del equipo.' }, { status: 409 })

    const update: { account_role?: string; is_active?: boolean } = {}
    if (role !== undefined) update.account_role = role
    if (isActive !== undefined) update.is_active = isActive
    const { error: updateError } = await admin.from('profiles').update(update).eq('account_id', accountId).eq('user_id', memberId)
    if (updateError) throw updateError
    return NextResponse.json({ message: isActive === false ? 'Usuario pausado: ya no puede ingresar ni consultar datos.' : 'Usuario actualizado.' })
  } catch (error) {
    return toErrorResponse(error)
  }
}
