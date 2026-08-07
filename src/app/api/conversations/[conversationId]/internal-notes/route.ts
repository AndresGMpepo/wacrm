import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

async function assertConversation(
  accountId: string,
  conversationId: string,
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
) {
  const { data, error } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  return Boolean(data)
}

async function notesWithAuthors(
  accountId: string,
  conversationId: string,
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
) {
  const { data: notes, error } = await supabase
    .from('conversation_internal_notes')
    .select('id, author_user_id, body, kind, created_at')
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  const authorIds = [...new Set((notes ?? []).map((note) => note.author_user_id))]
  const { data: profiles, error: profilesError } = authorIds.length
    ? await supabase.from('profiles').select('user_id, full_name').in('user_id', authorIds)
    : { data: [], error: null }
  if (profilesError) throw profilesError
  const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.full_name]))
  return (notes ?? []).map((note) => ({ ...note, author_name: names.get(note.author_user_id) ?? 'Miembro del equipo' }))
}

export async function GET(_: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { conversationId } = await params
    if (!await assertConversation(accountId, conversationId, supabase)) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    return NextResponse.json({ notes: await notesWithAuthors(accountId, conversationId, supabase) })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const { conversationId } = await params
    const payload = await request.json().catch(() => null)
    const body = typeof payload?.body === 'string' ? payload.body.trim() : ''
    const kind = payload?.kind === 'call_started' ? 'call_started' : 'note'
    if (!body || body.length > 2000) {
      return NextResponse.json({ error: 'La nota debe contener entre 1 y 2000 caracteres.' }, { status: 400 })
    }
    if (!await assertConversation(accountId, conversationId, supabase)) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    const { error } = await supabase.from('conversation_internal_notes').insert({
      account_id: accountId,
      conversation_id: conversationId,
      author_user_id: userId,
      body,
      kind,
    })
    if (error) throw error
    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
