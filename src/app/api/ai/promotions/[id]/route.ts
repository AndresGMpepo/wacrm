import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

const SELECT_COLUMNS = 'id, name, description, starts_on, ends_on, created_at, updated_at'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const update: Record<string, unknown> = {}
    if (typeof body.name === 'string') {
      const name = body.name.trim().slice(0, 160)
      if (!name) return bad('name cannot be empty')
      update.name = name
    }
    if (typeof body.description === 'string') {
      const description = body.description.trim().slice(0, 2000)
      if (!description) return bad('description cannot be empty')
      update.description = description
    }
    if (typeof body.starts_on === 'string') {
      if (Number.isNaN(new Date(body.starts_on).getTime())) return bad('starts_on must be a valid date')
      update.starts_on = body.starts_on
    }
    if (typeof body.ends_on === 'string') {
      if (Number.isNaN(new Date(body.ends_on).getTime())) return bad('ends_on must be a valid date')
      update.ends_on = body.ends_on
    }
    if (Object.keys(update).length === 0) return bad('Nothing to update')

    const { data: existing, error: existingErr } = await supabase
      .from('ai_promotions')
      .select('starts_on, ends_on')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (existingErr) throw existingErr
    if (!existing) return NextResponse.json({ error: 'Promotion not found' }, { status: 404 })

    const nextStarts = (update.starts_on as string | undefined) ?? existing.starts_on
    const nextEnds = (update.ends_on as string | undefined) ?? existing.ends_on
    if (nextEnds < nextStarts) return bad('ends_on must be on or after starts_on')

    const { data, error } = await supabase
      .from('ai_promotions')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
      .select(SELECT_COLUMNS)
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Promotion not found' }, { status: 404 })
    return NextResponse.json({ promotion: data })
  } catch (err) { return toErrorResponse(err) }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params
    const { error } = await supabase.from('ai_promotions').delete().eq('id', id).eq('account_id', accountId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) { return toErrorResponse(err) }
}
