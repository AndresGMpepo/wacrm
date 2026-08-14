import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'

const SAFE_COLUMNS = 'id, endpoint_id, event_type, outcome, http_status, detail, created_at'

/** Recent metadata-only n8n deliveries for the current account. */
export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const { data, error } = await ctx.supabase
      .from('n8n_delivery_receipts')
      .select(SAFE_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(12)

    if (error) throw error
    return NextResponse.json({ deliveries: data ?? [] })
  } catch (error) {
    return toErrorResponse(error)
  }
}
