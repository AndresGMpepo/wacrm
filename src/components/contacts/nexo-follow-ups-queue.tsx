'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, PhoneCall, RefreshCw, ShieldAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useTelephony } from '@/components/telephony/telephony-provider'

type Analysis = { sentiment?: string | null; sentiment_score?: number | null; qa_score?: number | null; next_best_action?: string | null }
type CallTask = { id: string; conversation_id: string; due_at: string; conversation?: { contact?: { name?: string; phone?: string } | null } | null; latest_analysis?: Analysis | null }
type Commitment = { id: string; contact_id: string; contact_name: string; description: string; owner: 'agent' | 'customer'; due_date: string | null }
type HighRiskContact = { contact_id: string; contact_name: string; opportunity_score: number | null; next_best_action: string | null; updated_at: string }
type StaleProspect = { contact_id: string; contact_name: string; current_stage: string | null; updated_at: string }

/** One unified shape so a call no-reply task and a Nexo Memory signal
 *  (overdue commitment, high-risk contact, stale prospect) render as the
 *  same kind of row instead of two visually redundant lists. */
type FollowUpItem = {
  key: string
  since: string
  contactName: string
  contactPhone: string | null
  detail: string
  meta: string | null
  metaClass: string
  conversationId: string | null
  commitment: { id: string; contactId: string } | null
}

const sentimentLabel: Record<string, string> = { positive: 'Positivo', neutral: 'Neutral', negative: 'Negativo', mixed: 'Mixto' }
const sentimentClass: Record<string, string> = { positive: 'text-emerald-500', neutral: 'text-sky-500', negative: 'text-red-500', mixed: 'text-amber-500' }

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function NexoFollowUpsQueue() {
  const [items, setItems] = useState<FollowUpItem[]>([])
  const [loading, setLoading] = useState(true)
  const telephony = useTelephony()

  const load = useCallback(async () => {
    try {
      const [callTasksResponse, memoryResponse] = await Promise.all([
        fetch('/api/telephony/follow-up-tasks', { cache: 'no-store' }),
        fetch('/api/contacts/memory/follow-ups', { cache: 'no-store' }),
      ])
      const callTasksData = callTasksResponse.ok ? await callTasksResponse.json() : null
      const memoryData = memoryResponse.ok ? await memoryResponse.json() : null
      if (!callTasksResponse.ok && !memoryResponse.ok) throw new Error('No se pudieron cargar los seguimientos.')

      const callItems: FollowUpItem[] = ((callTasksData?.tasks ?? []) as CallTask[]).map((task) => {
        const analysis = task.latest_analysis
        const sentiment = analysis?.sentiment ?? ''
        return {
          key: `call-${task.id}`,
          since: task.due_at,
          contactName: task.conversation?.contact?.name || task.conversation?.contact?.phone || 'Contacto',
          contactPhone: task.conversation?.contact?.phone ?? null,
          detail: analysis?.next_best_action || 'Sin análisis previo: atiende el seguimiento desde el historial del chat.',
          meta: analysis ? `${sentimentLabel[sentiment] ?? 'Sin sentimiento'}${analysis.sentiment_score != null ? ` · ${analysis.sentiment_score}/100` : ''}${analysis.qa_score != null ? ` · QA ${analysis.qa_score}/100` : ''}` : null,
          metaClass: sentimentClass[sentiment] ?? 'text-muted-foreground',
          conversationId: task.conversation_id,
          commitment: null,
        }
      })
      const commitmentItems: FollowUpItem[] = ((memoryData?.overdue_commitments ?? []) as Commitment[]).map((item) => ({
        key: `commitment-${item.id}`,
        since: item.due_date ?? new Date(0).toISOString(),
        contactName: item.contact_name,
        contactPhone: null,
        detail: `${item.description}${item.owner === 'customer' ? ' (cliente)' : ''}`,
        meta: 'Compromiso vencido (Nexo Memory)',
        metaClass: 'text-amber-500',
        conversationId: null,
        commitment: { id: item.id, contactId: item.contact_id },
      }))
      const riskItems: FollowUpItem[] = ((memoryData?.high_risk_contacts ?? []) as HighRiskContact[]).map((item) => ({
        key: `risk-${item.contact_id}`,
        since: item.updated_at,
        contactName: item.contact_name,
        contactPhone: null,
        detail: item.next_best_action || 'Revisar la relación con este cliente.',
        meta: `Riesgo alto (Nexo Memory)${item.opportunity_score != null ? ` · Oportunidad ${item.opportunity_score}/100` : ''}`,
        metaClass: 'text-red-500',
        conversationId: null,
        commitment: null,
      }))
      const staleItems: FollowUpItem[] = ((memoryData?.stale_prospects ?? []) as StaleProspect[]).map((item) => ({
        key: `stale-${item.contact_id}`,
        since: item.updated_at,
        contactName: item.contact_name,
        contactPhone: null,
        detail: item.current_stage ? `Etapa: ${item.current_stage}` : 'Sin seguimiento reciente.',
        meta: 'Sin seguimiento en 48h (Nexo Memory)',
        metaClass: 'text-muted-foreground',
        conversationId: null,
        commitment: null,
      }))

      setItems([...callItems, ...commitmentItems, ...riskItems, ...staleItems].sort((a, b) => a.since.localeCompare(b.since)))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los seguimientos.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const finishCallTask = async (key: string, status: 'completed' | 'cancelled') => {
    const id = key.replace('call-', '')
    const response = await fetch('/api/telephony/follow-up-tasks', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }),
    })
    if (!response.ok) { toast.error('No se pudo actualizar el seguimiento.'); return }
    setItems((current) => current.filter((item) => item.key !== key))
  }

  const markCommitmentDone = async (key: string, commitment: { id: string; contactId: string }) => {
    const response = await fetch(`/api/contacts/${commitment.contactId}/memory/commitments/${commitment.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }),
    })
    if (!response.ok) { toast.error('No se pudo actualizar el compromiso.'); return }
    setItems((current) => current.filter((item) => item.key !== key))
  }

  return <div className="space-y-3">
    {loading ? <p className="text-sm text-muted-foreground">Cargando seguimientos…</p> : items.length ? items.map((item) => (
      <div key={item.key} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
        <div className="min-w-50 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium">{item.commitment ? null : item.meta?.includes('Riesgo alto') ? <ShieldAlert className="size-3.5 text-red-400" /> : null}{item.contactName}</p>
          <p className="text-xs text-muted-foreground">Pendiente desde {formatDate(item.since)}</p>
          {item.meta ? <p className={`mt-1 text-xs ${item.metaClass}`}>{item.meta}</p> : null}
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{item.detail}</p>
        </div>
        {item.conversationId ? <Link className="text-xs text-primary hover:underline" href={`/inbox?c=${item.conversationId}`}>Abrir chat</Link> : <Link className="text-xs text-primary hover:underline" href="/contacts">Ver contacto</Link>}
        {item.conversationId ? <Button size="sm" variant="outline" disabled={!item.contactPhone || !telephony.connected} onClick={() => void telephony.call(item.contactPhone!)}><PhoneCall className="size-3.5" />Llamar</Button> : null}
        {item.commitment ? (
          <Button size="icon" variant="ghost" title="Marcar hecho" onClick={() => void markCommitmentDone(item.key, item.commitment!)}><Check className="size-4 text-emerald-500" /></Button>
        ) : item.conversationId ? (
          <>
            <Button size="icon" variant="ghost" title="Completar" onClick={() => void finishCallTask(item.key, 'completed')}><Check className="size-4 text-emerald-500" /></Button>
            <Button size="icon" variant="ghost" title="Descartar" onClick={() => void finishCallTask(item.key, 'cancelled')}><X className="size-4 text-muted-foreground" /></Button>
          </>
        ) : null}
      </div>
    )) : <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No tienes seguimientos pendientes.</p>}
    <Button size="sm" variant="ghost" onClick={() => { setLoading(true); void load() }}><RefreshCw className="size-3.5" />Actualizar</Button>
  </div>
}
