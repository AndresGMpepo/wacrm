// Sidebar discovery endpoint for the protected platform console.
// It intentionally returns a simple boolean. Actual commercial routes still
// call requirePlatformOperator(), so hiding this link never grants access.

import { NextResponse } from 'next/server'

import { UnauthorizedError, toErrorResponse } from '@/lib/auth/account'
import { requirePlatformOperator } from '@/lib/platform/operator'

export async function GET() {
  try {
    await requirePlatformOperator()
    return NextResponse.json({ allowed: true })
  } catch (error) {
    if (error instanceof UnauthorizedError) return toErrorResponse(error)
    return NextResponse.json({ allowed: false })
  }
}
