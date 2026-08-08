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

function appUrl() {
  const url = process.env.NEXT_PUBLIC_SITE_URL
  if (!url) throw new Error('Missing NEXT_PUBLIC_SITE_URL')
  return url.replace(/\/$/, '')
}

export async function POST(_request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  try {
    const operator = await requirePlatformOperator()
    const limit = checkRateLimit(`platform:account-invite:${operator.user.id}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { accountId } = await params
    const admin = adminClient()
    const { data: account, error: accountError } = await admin.from('accounts').select('owner_user_id').eq('id', accountId).maybeSingle()
    if (accountError) throw accountError
    if (!account) return NextResponse.json({ error: 'La cuenta ya no existe.' }, { status: 404 })

    const [{ data: owner, error: profileError }, { data: authResult, error: authError }] = await Promise.all([
      admin.from('profiles').select('full_name, email').eq('user_id', account.owner_user_id).maybeSingle(),
      admin.auth.admin.getUserById(account.owner_user_id),
    ])
    if (profileError || authError || !owner || !authResult.user) throw profileError ?? authError ?? new Error('Owner data is missing')
    if (authResult.user.email_confirmed_at) return NextResponse.json({ error: 'Este propietario ya activó su acceso. Debe usar “Olvidé mi contraseña” si necesita recuperar el ingreso.' }, { status: 409 })

    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(owner.email, {
      data: { full_name: owner.full_name ?? '', platform_provisioned: true },
      redirectTo: `${appUrl()}/set-password`,
    })
    if (inviteError) return NextResponse.json({ error: inviteError.message }, { status: 400 })
    return NextResponse.json({ message: 'Invitación reenviada. El enlace anterior deja de ser válido.' })
  } catch (error) {
    return toErrorResponse(error)
  }
}
