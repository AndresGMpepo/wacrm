'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, RefreshCw, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type Commitment = { id: string; contact_id: string; contact_name: string; description: string; owner: 'agent' | 'customer'; due_date: string | null }
type HighRiskContact = { contact_id: string; contact_name: string; opportunity_score: number | null; next_best_action: string | null; updated_at: string }
type StaleProspect = { contact_id: string; contact_name: string; current_stage: string | null; updated_at: string }

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(value)) : ''
}

export function NexoMemoryFollowUpQueue() {
  const [overdueCommitments, setOverdueCommitments] = useState<Commitment[]>([])
  const [highRiskContacts, setHighRiskContacts] = useState<HighRiskContact[]>([])
  const [staleProspects, setStaleProspects] = useState<StaleProspect[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/contacts/memory/follow-ups', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setOverdueCommitments(data.overdue_commitments ?? [])
      setHighRiskContacts(data.high_risk_contacts ?? [])
      setStaleProspects(data.stale_prospects ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los seguimientos de Nexo Memory.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const markDone = async (commitmentId: string, contactId: string) => {
    const response = await fetch(`/api/contacts/${contactId}/memory/commitments/${commitmentId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }),
    })
    if (!response.ok) { toast.error('No se pudo actualizar el compromiso.'); return }
    setOverdueCommitments((items) => items.filter((item) => item.id !== commitmentId))
  }

  const total = overdueCommitments.length + highRiskContacts.length + staleProspects.length

  return <div className="space-y-3">
    {loading ? <p className="text-sm text-muted-foreground">Cargando seguimientos de Nexo Memory…</p> : total === 0 ? (
      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No hay seguimientos de Nexo Memory pendientes.</p>
    ) : <>
      {overdueCommitments.map((item) => (
        <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 p-3">
          <div className="min-w-50 flex-1">
            <p className="text-sm font-medium">{item.contact_name}</p>
            <p className="mt-1 text-xs text-amber-500">Compromiso vencido{item.due_date ? ` desde ${formatDate(item.due_date)}` : ''}</p>
            <p className="mt-1 text-xs text-muted-foreground">{item.description}{item.owner === 'customer' ? ' (cliente)' : ''}</p>
          </div>
          <Link className="text-xs text-primary hover:underline" href="/contacts">Ver contacto</Link>
          <Button size="icon" variant="ghost" title="Marcar hecho" onClick={() => void markDone(item.id, item.contact_id)}><Check className="size-4 text-emerald-500" /></Button>
        </div>
      ))}
      {highRiskContacts.map((item) => (
        <div key={item.contact_id} className="flex flex-wrap items-center gap-3 rounded-lg border border-red-500/30 p-3">
          <div className="min-w-50 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-medium"><ShieldAlert className="size-3.5 text-red-400" /> {item.contact_name}</p>
            <p className="mt-1 text-xs text-red-400">Riesgo alto{item.opportunity_score !== null ? ` · Oportunidad ${item.opportunity_score}/100` : ''}</p>
            {item.next_best_action ? <p className="mt-1 text-xs text-muted-foreground">{item.next_best_action}</p> : null}
          </div>
          <Link className="text-xs text-primary hover:underline" href="/contacts">Ver contacto</Link>
        </div>
      ))}
      {staleProspects.map((item) => (
        <div key={item.contact_id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
          <div className="min-w-50 flex-1">
            <p className="text-sm font-medium">{item.contact_name}</p>
            <p className="mt-1 text-xs text-muted-foreground">Sin seguimiento desde {formatDate(item.updated_at)}{item.current_stage ? ` · ${item.current_stage}` : ''}</p>
          </div>
          <Link className="text-xs text-primary hover:underline" href="/contacts">Ver contacto</Link>
        </div>
      ))}
    </>}
    <Button size="sm" variant="ghost" onClick={() => { setLoading(true); void load() }}><RefreshCw className="size-3.5" />Actualizar</Button>
  </div>
}
