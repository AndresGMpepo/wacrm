'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BellRing, StickyNote } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

export function InternalNoteAttention({ conversationId, onOpen }: { conversationId: string; onOpen: () => void }) {
  const [unread, setUnread] = useState(0)
  const loaded = useRef(false)
  const previousUnread = useRef(0)

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/conversations/${conversationId}/internal-notes`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) return
      const next = Number(data.unread_count ?? 0)
      if (loaded.current && next > previousUnread.current) {
        toast.warning('Tienes una nueva nota interna de seguimiento.', { duration: 7000 })
      }
      previousUnread.current = next
      loaded.current = true
      setUnread(next)
    } catch {
      // A failed reminder fetch must never interfere with the active chat.
    }
  }, [conversationId])

  useEffect(() => {
    loaded.current = false
    previousUnread.current = 0
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`internal-note-attention:${conversationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_internal_notes', filter: `conversation_id=eq.${conversationId}` }, () => void load())
      .subscribe()
    const onRead = () => void load()
    window.addEventListener(`internal-note-read:${conversationId}`, onRead)
    return () => { supabase.removeChannel(channel); window.removeEventListener(`internal-note-read:${conversationId}`, onRead) }
  }, [conversationId, load])

  if (!unread) return null
  return <button type="button" onClick={onOpen} className={cn('hidden items-center gap-1.5 rounded-md bg-amber-500/15 px-2 py-1 text-xs font-semibold text-amber-500 transition-colors hover:bg-amber-500/25 sm:inline-flex', unread > 0 && 'animate-pulse')} title="Abrir notas internas pendientes">
    <BellRing className="size-3.5" /><StickyNote className="size-3.5" />
    {unread} seguimiento{unread === 1 ? '' : 's'}
  </button>
}
