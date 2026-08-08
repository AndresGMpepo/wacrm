// Tenant-created invitation links are deliberately disabled. WACRM is
// provisioned by contracted seat, so the platform operation is the only
// place where a new user can be added to an account.

import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'

export async function GET() {
  try {
    await requireRole('admin')
    return NextResponse.json({ invitations: [] })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST() {
  try {
    await requireRole('admin')
    return NextResponse.json(
      {
        error:
          'La creación de usuarios la gestiona el equipo de plataforma según los asientos contratados.',
      },
      { status: 403 },
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}
