import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

const SELECT_COLUMNS = 'id, name, description, starts_on, ends_on, created_at, updated_at'

/**
 * Promotions the AI assistant may mention via the {{active_promotions}}
 * prompt variable (see src/lib/ai/prompt-variables.ts). Any member can
 * read (so e.g. the Setup tab can show "N active" without an admin
 * session); only admin+ may create.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { data, error } = await supabase
      .from('ai_promotions')
      .select(SELECT_COLUMNS)
      .eq('account_id', accountId)
      .order('starts_on', { ascending: false })
    if (error) throw error
    return NextResponse.json({ promotions: data ?? [] })
  } catch (err) { return toErrorResponse(err) }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 160) : ''
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 2000) : ''
    const startsOn = typeof body.starts_on === 'string' ? body.starts_on : ''
    const endsOn = typeof body.ends_on === 'string' ? body.ends_on : ''
    if (!name) return bad('name is required')
    if (!description) return bad('description is required')
    if (!startsOn || Number.isNaN(new Date(startsOn).getTime())) return bad('starts_on must be a valid date')
    if (!endsOn || Number.isNaN(new Date(endsOn).getTime())) return bad('ends_on must be a valid date')
    if (endsOn < startsOn) return bad('ends_on must be on or after starts_on')

    const { data, error } = await supabase
      .from('ai_promotions')
      .insert({ account_id: accountId, name, description, starts_on: startsOn, ends_on: endsOn, created_by: userId })
      .select(SELECT_COLUMNS)
      .single()
    if (error) throw error
    return NextResponse.json({ promotion: data }, { status: 201 })
  } catch (err) { return toErrorResponse(err) }
}
