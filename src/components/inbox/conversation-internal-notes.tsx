'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Loader2, LockKeyhole, PhoneCall, Send, StickyNote } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { createClient } from '@/lib/supabase/client'

type Note = { id: string; author_user_id: string; author_name: string; body: string; kind: 'note' | 'call_started'; created_at: string }

export function ConversationInternalNotes({ conversationId }: { conversationId: string }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [expanded, setExpanded] = useState(false)
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/conversations/${conversationId}/internal-notes`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'No se pudieron cargar las notas.')
      setNotes(data.notes ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar las notas.')
    } finally {
      setLoading(false)
    }
  }, [conversationId])

  useEffect(() => { setLoading(true); void load() }, [load])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`conversation-internal-notes:${conversationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_internal_notes', filter: `conversation_id=eq.${conversationId}` }, () => void load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [conversationId, load])

  const addNote = async () => {
    const value = body.trim()
    if (!value || saving) return
    setSaving(true)
    try {
      const response = await fetch(`/api/conversations/${conversationId}/internal-notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: value }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'No se pudo guardar la nota.')
      setBody('')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la nota.')
    } finally {
      setSaving(false)
    }
  }

  return <section className="border-t border-border bg-card px-4 py-3">
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2"><StickyNote className="size-4 shrink-0 text-amber-500" /><p className="text-sm font-medium">Notas internas{notes.length ? ` (${notes.length})` : ''}</p><span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><LockKeyhole className="size-2.5" />Solo equipo</span></div>
      <Button size="icon" variant="ghost" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? 'Ocultar notas internas' : 'Mostrar notas internas'}>{expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</Button>
    </div>
    {expanded ? <div className="mt-3 space-y-2"><div className="max-h-36 space-y-2 overflow-y-auto">{loading ? <p className="text-xs text-muted-foreground">Cargando notas…</p> : notes.length ? notes.map((note) => <article key={note.id} className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2 text-xs"><p className="font-medium text-foreground">{note.kind === 'call_started' ? <PhoneCall className="mr-1 inline size-3 text-primary" /> : null}{note.author_name}<span className="ml-1 font-normal text-muted-foreground">· {new Date(note.created_at).toLocaleString()}</span></p><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{note.body}</p></article>) : <p className="text-xs text-muted-foreground">Aún no hay indicaciones internas.</p>}</div><div className="flex items-end gap-2"><Textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Escribe una indicación para el equipo…" rows={2} maxLength={2000} disabled={saving} /><Button size="icon" onClick={() => void addNote()} disabled={!body.trim() || saving} title="Guardar nota interna">{saving ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}</Button></div></div> : null}
  </section>
}
