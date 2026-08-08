import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { getAccountEntitlements } from '@/lib/account/entitlements'

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const entitlements = await getAccountEntitlements(ctx.supabase, ctx.accountId)
    if (!entitlements) {
      return NextResponse.json({ error: 'La cuenta aún no tiene un plan aprovisionado.' }, { status: 409 })
    }
    return NextResponse.json({ entitlements })
  } catch (error) {
    return toErrorResponse(error)
  }
}
