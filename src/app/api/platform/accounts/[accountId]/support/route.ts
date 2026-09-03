import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { requirePlatformOperator } from '@/lib/platform/operator'
import {
  DEFAULT_SUPPORT_MINUTES,
  endSupportSessions,
  getActiveSupportSession,
  logSupportAudit,
  startSupportSession,
  supportAdminClient,
} from '@/lib/platform/support-session'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'

async function accountName(db: ReturnType<typeof supportAdminClient>, accountId: string) {
  const { data } = await db.from('accounts').select('name').eq('id', accountId).maybeSingle()
  return (data?.name as string) ?? 'Cuenta desconocida'
}

/** GET — is there a live support session for this operator on this account? */
export async function GET(_request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  try {
    const operator = await requirePlatformOperator()
    const { accountId } = await params
    const db = supportAdminClient()
    const session = await getActiveSupportSession(db, accountId, operator.user.email ?? '')
    return NextResponse.json({ session })
  } catch (error) {
    return toErrorResponse(error)
  }
}

/** POST — open a time-boxed session. Body: { reason, minutes? } */
export async function POST(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  try {
    const operator = await requirePlatformOperator()
    const limit = checkRateLimit(`platform:support-start:${operator.user.id}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { accountId } = await params
    const body = (await request.json().catch(() => null)) as { reason?: unknown; minutes?: unknown } | null
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 300) : ''
    if (reason.length < 3) {
      return NextResponse.json({ error: 'Describe el motivo del acceso de soporte.' }, { status: 400 })
    }
    const minutes = Number(body?.minutes) || DEFAULT_SUPPORT_MINUTES

    const db = supportAdminClient()
    const { data: account } = await db.from('accounts').select('id, name').eq('id', accountId).maybeSingle()
    if (!account) return NextResponse.json({ error: 'La cuenta no existe.' }, { status: 404 })

    const session = await startSupportSession(db, {
      accountId,
      operatorUserId: operator.user.id,
      operatorEmail: operator.user.email ?? '',
      reason,
      minutes,
    })
    await logSupportAudit(db, {
      accountId,
      accountName: account.name as string,
      actorUserId: operator.user.id,
      action: 'support_session_started',
      details: { reason, expires_at: session.expires_at, operator_email: operator.user.email },
    })

    return NextResponse.json({ session }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}

/** DELETE — close every live session this operator has on the account. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  try {
    const operator = await requirePlatformOperator()
    const { accountId } = await params
    const db = supportAdminClient()
    const closed = await endSupportSessions(db, accountId, operator.user.email ?? '')
    if (closed > 0) {
      await logSupportAudit(db, {
        accountId,
        accountName: await accountName(db, accountId),
        actorUserId: operator.user.id,
        action: 'support_session_ended',
        details: { closed, operator_email: operator.user.email },
      })
    }
    return NextResponse.json({ closed })
  } catch (error) {
    return toErrorResponse(error)
  }
}
