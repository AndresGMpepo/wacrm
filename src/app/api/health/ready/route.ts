import { NextRequest, NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/ai/admin-client'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

const CHECK_TIMEOUT_MS = 8_000

async function succeeds(operation: () => Promise<unknown>) {
  let timeout: ReturnType<typeof setTimeout> | undefined

  try {
    await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Health check timed out')), CHECK_TIMEOUT_MS)
      }),
    ])
    return true
  } catch {
    return false
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

/**
 * Authenticated readiness endpoint for monitoring.
 *
 * Unlike /api/health (liveness), this verifies the two WACRM dependencies
 * needed to serve requests: Postgres through Supabase and Supabase Storage.
 * It intentionally returns no tenant data and requires a private header.
 */
export async function GET(request: NextRequest) {
  const expectedSecret = process.env.HEALTHCHECK_SECRET
  const suppliedSecret = request.headers.get('x-healthcheck-secret')

  // Return a generic response so this endpoint is not discoverable or useful
  // to unauthenticated callers. Never place this secret in a query string.
  if (!expectedSecret || suppliedSecret !== expectedSecret) {
    return new NextResponse(null, {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const client = supabaseAdmin()

  const [database, storage] = await Promise.all([
    succeeds(async () => {
      const { error } = await client.from('accounts').select('id', { head: true }).limit(1)
      if (error) throw error
    }),
    succeeds(async () => {
      const { error } = await client.storage.listBuckets()
      if (error) throw error
    }),
  ])

  const healthy = database && storage

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      checked_at: new Date().toISOString(),
      checks: {
        database: database ? 'ok' : 'failed',
        storage: storage ? 'ok' : 'failed',
      },
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
