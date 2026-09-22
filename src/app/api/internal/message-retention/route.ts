import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase server configuration')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

/**
 * Global message-retention cron — deletes `messages` older than the
 * platform operator's configured `platform_settings.message_retention_days`
 * (migration 121's `purge_old_messages()`). No-op when retention is unset.
 * Meant to run once a day via an external cron hitting this route (same
 * pattern as scripts/run-flows-cron.mjs), never from inside the request
 * path of a tenant action.
 */
export async function POST(request: Request) {
  const secret = process.env.MESSAGE_RETENTION_CRON_SECRET
  if (!secret || request.headers.get('x-retention-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const admin = adminClient()
    const { data, error } = await admin.rpc('purge_old_messages')
    if (error) throw error
    return NextResponse.json(data ?? { enabled: false, deleted: 0 })
  } catch (error) {
    console.error('[message-retention] purge failed:', error)
    return NextResponse.json({ error: 'Purge failed' }, { status: 500 })
  }
}
