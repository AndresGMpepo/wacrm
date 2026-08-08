import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { ForbiddenError, toErrorResponse } from '@/lib/auth/account'
import { PLAN_CODES, type PlanCode } from '@/lib/account/entitlements'
import { requirePlatformOperator } from '@/lib/platform/operator'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'

const MAX_ACCOUNT_NAME = 80
const MAX_OWNER_NAME = 120
const MAX_ACCESS_DAYS = 3650
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase server configuration')
  return createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

function appUrl() {
  const url = process.env.NEXT_PUBLIC_SITE_URL
  if (!url) throw new Error('Missing NEXT_PUBLIC_SITE_URL')
  return url.replace(/\/$/, '')
}

type SubscriptionRow = {
  account_id: string
  plan_code: PlanCode
  seat_limit: number
  status: string
  ends_at: string | null
  grace_days: number
  contract_reference: string | null
  invoice_reference: string | null
  internal_notes: string | null
}

type ProfileRow = {
  account_id: string
  user_id: string
  full_name: string | null
  email: string | null
  account_role: 'owner' | 'admin' | 'agent' | 'viewer'
  is_active: boolean
}

export async function GET() {
  try {
    await requirePlatformOperator()
    const admin = adminClient()
    const [{ data: accounts, error: accountsError }, { data: subscriptions, error: subscriptionsError }, { data: profiles, error: profilesError }] = await Promise.all([
      admin.from('accounts').select('id, name, owner_user_id, created_at').order('created_at', { ascending: false }),
      admin.from('account_subscriptions').select('account_id, plan_code, seat_limit, status, ends_at, grace_days, contract_reference, invoice_reference, internal_notes'),
      admin.from('profiles').select('account_id, user_id, full_name, email, account_role, is_active'),
    ])
    if (accountsError || subscriptionsError || profilesError) throw accountsError ?? subscriptionsError ?? profilesError

    const subscriptionByAccount = new Map((subscriptions as SubscriptionRow[]).map((row) => [row.account_id, row]))
    const membersByAccount = new Map<string, number>()
    const typedProfiles = (profiles ?? []) as ProfileRow[]
    const ownersByUser = new Map(typedProfiles.map((profile) => [profile.user_id, profile]))
    const profilesByAccount = new Map<string, ProfileRow[]>()
    for (const profile of typedProfiles) {
      membersByAccount.set(profile.account_id, (membersByAccount.get(profile.account_id) ?? 0) + 1)
      const accountProfiles = profilesByAccount.get(profile.account_id) ?? []
      accountProfiles.push(profile)
      profilesByAccount.set(profile.account_id, accountProfiles)
    }

    return NextResponse.json({
      accounts: (accounts ?? []).map((account) => {
        const subscription = subscriptionByAccount.get(account.id)
        const owner = ownersByUser.get(account.owner_user_id)
        return {
          id: account.id,
          name: account.name,
          created_at: account.created_at,
          owner: owner ? { full_name: owner.full_name, email: owner.email } : null,
          members: membersByAccount.get(account.id) ?? 0,
          team: (profilesByAccount.get(account.id) ?? []).map((profile) => ({
            user_id: profile.user_id,
            full_name: profile.full_name,
            email: profile.email,
            role: profile.account_role,
            is_active: profile.is_active,
          })),
          subscription: subscription ? {
            plan_code: subscription.plan_code,
            seat_limit: subscription.seat_limit,
            status: subscription.status,
            ends_at: subscription.ends_at,
            grace_days: subscription.grace_days,
            contract_reference: subscription.contract_reference,
            invoice_reference: subscription.invoice_reference,
            internal_notes: subscription.internal_notes,
          } : null,
        }
      }),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const operator = await requirePlatformOperator()
    const limit = checkRateLimit(`platform:provision:${operator.user.id}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const accountName = typeof body?.account_name === 'string' ? body.account_name.trim() : ''
    const ownerName = typeof body?.owner_name === 'string' ? body.owner_name.trim() : ''
    const ownerEmail = typeof body?.owner_email === 'string' ? body.owner_email.trim().toLowerCase() : ''
    const planCode = typeof body?.plan_code === 'string' ? body.plan_code : ''
    const seatLimit = typeof body?.seat_limit === 'number' ? body.seat_limit : Number(body?.seat_limit)
    const accessDays = typeof body?.access_days === 'number' ? body.access_days : Number(body?.access_days ?? 0)

    if (!accountName || accountName.length > MAX_ACCOUNT_NAME) return NextResponse.json({ error: 'Indica un nombre de cuenta de hasta 80 caracteres.' }, { status: 400 })
    if (!ownerName || ownerName.length > MAX_OWNER_NAME) return NextResponse.json({ error: 'Indica el nombre del propietario.' }, { status: 400 })
    if (!EMAIL_RE.test(ownerEmail)) return NextResponse.json({ error: 'Indica un correo válido para el propietario.' }, { status: 400 })
    if (!(PLAN_CODES as readonly string[]).includes(planCode)) return NextResponse.json({ error: 'El plan seleccionado no es válido.' }, { status: 400 })
    if (!Number.isInteger(seatLimit) || seatLimit < 1 || seatLimit > 1000) return NextResponse.json({ error: 'Los usuarios contratados deben estar entre 1 y 1000.' }, { status: 400 })
    if (!Number.isInteger(accessDays) || accessDays < 0 || accessDays > MAX_ACCESS_DAYS) return NextResponse.json({ error: 'Los días de acceso deben estar entre 0 y 3650.' }, { status: 400 })

    const endsAt = accessDays > 0 ? new Date(Date.now() + accessDays * 86_400_000).toISOString() : null

    const admin = adminClient()
    const { data: invitation, error: invitationError } = await admin.auth.admin.inviteUserByEmail(ownerEmail, {
      data: { full_name: ownerName, platform_provisioned: true },
      redirectTo: `${appUrl()}/set-password`,
    })
    if (invitationError || !invitation.user) {
      return NextResponse.json({ error: invitationError?.message ?? 'No se pudo enviar la invitación.' }, { status: 400 })
    }

    const ownerUserId = invitation.user.id
    let accountId: string | null = null
    try {
      const { data: account, error: accountError } = await admin
        .from('accounts')
        .insert({ name: accountName, owner_user_id: ownerUserId })
        .select('id, name')
        .single()
      if (accountError || !account) throw accountError ?? new Error('Account insert did not return a row')
      accountId = account.id

      const { error: subscriptionError } = await admin.from('account_subscriptions').insert({
        account_id: account.id,
        plan_code: planCode,
        seat_limit: seatLimit,
        status: accessDays > 0 ? 'trial' : 'active',
        ends_at: endsAt,
      })
      if (subscriptionError) throw subscriptionError

      const { error: profileError } = await admin.from('profiles').insert({
        user_id: ownerUserId,
        full_name: ownerName,
        email: ownerEmail,
        account_id: account.id,
        account_role: 'owner',
      })
      if (profileError) throw profileError

      return NextResponse.json({
        account: { id: account.id, name: account.name, plan_code: planCode, seat_limit: seatLimit, ends_at: endsAt },
        message: 'Cuenta creada. El propietario recibió un correo para definir su contraseña.',
      }, { status: 201 })
    } catch (provisionError) {
      console.error('[POST /api/platform/accounts] provision error:', provisionError)
      if (accountId) await admin.from('accounts').delete().eq('id', accountId)
      await admin.auth.admin.deleteUser(ownerUserId)
      return NextResponse.json({ error: 'No se pudo aprovisionar la cuenta. No se creó ningún acceso utilizable.' }, { status: 500 })
    }
  } catch (error) {
    if (error instanceof ForbiddenError) return toErrorResponse(error)
    return toErrorResponse(error)
  }
}
