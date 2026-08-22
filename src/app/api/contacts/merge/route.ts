import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireRole, toErrorResponse } from '@/lib/auth/account'

function admin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const survivorContactId = typeof body?.survivorContactId === 'string' ? body.survivorContactId : null
    const loserContactId = typeof body?.loserContactId === 'string' ? body.loserContactId : null
    if (!survivorContactId || !loserContactId) {
      return NextResponse.json({ error: 'Indica los dos contactos a fusionar.' }, { status: 400 })
    }
    if (survivorContactId === loserContactId) {
      return NextResponse.json({ error: 'No se puede fusionar un contacto consigo mismo.' }, { status: 400 })
    }
    const db = admin()
    const { data, error } = await db.rpc('merge_contacts', {
      p_account_id: ctx.account.id,
      p_survivor_id: survivorContactId,
      p_loser_id: loserContactId,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    const { data: contact, error: contactError } = await db.from('contacts')
      .select('id, name, phone, email, company, avatar_url')
      .eq('id', data).eq('account_id', ctx.account.id).maybeSingle()
    if (contactError) throw contactError
    return NextResponse.json({ contact })
  } catch (error) {
    return toErrorResponse(error)
  }
}
