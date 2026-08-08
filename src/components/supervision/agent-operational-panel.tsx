'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2, PhoneCall, RefreshCw, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PresenceDot } from '@/components/presence/presence-dot'
import type { PresenceStatus } from '@/lib/presence'

type Agent = {
  id: string
  name: string
  role: string
  presence: PresenceStatus
  extension: string | null
  in_call: boolean
  open_conversations: number
  negative_conversations: number
  critical_conversation_id: string | null
}

export function AgentOperationalPanel() {
  const router = useRouter()
  const [agents, setAgents] = useState<Agent[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [takingFollowUp, setTakingFollowUp] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const response = await fetch('/api/supervision/operational-agents', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'No se pudo cargar el estado de agentes.')
      setAgents(data.agents ?? [])
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : 'No se pudo cargar el estado de agentes.')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const timer = window.setInterval(() => void load(true), 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  const online = agents?.filter((agent) => agent.presence === 'online').length ?? 0
  const calls = agents?.filter((agent) => agent.in_call).length ?? 0
  const critical = agents?.reduce((sum, agent) => sum + agent.negative_conversations, 0) ?? 0

  const takeFollowUp = async (agent: Agent) => {
    if (!agent.critical_conversation_id) return
    setTakingFollowUp(agent.id)
    try {
      const response = await fetch('/api/supervision/interventions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: agent.critical_conversation_id, action: 'claim' }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'No se pudo registrar el seguimiento.')
      toast.success('Seguimiento registrado. Abriendo conversación.')
      router.push(`/inbox?c=${agent.critical_conversation_id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar el seguimiento.')
    } finally {
      setTakingFollowUp(null)
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold"><UsersRound className="size-4 text-primary" />Estado operativo de agentes</h2>
          <p className="mt-1 text-sm text-muted-foreground">Disponibilidad, carga de conversaciones, llamadas y atención prioritaria.</p>
        </div>
        <Button size="icon" variant="ghost" title="Actualizar" disabled={loading} onClick={() => void load()}><RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} /></Button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Metric label="En línea" value={online} tone="success" />
        <Metric label="En llamada" value={calls} tone="primary" />
        <Metric label="Alertas negativas" value={critical} tone="danger" />
      </div>
      {loading && !agents ? (
        <div className="flex h-24 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : agents?.length ? (
        <div className="mt-4 divide-y rounded-lg border border-border">
          {agents.map((agent) => (
            <div key={agent.id} className="flex flex-wrap items-center gap-3 p-3">
              <PresenceDot status={agent.presence} label={agent.presence} />
              <div className="min-w-40 flex-1"><p className="text-sm font-medium">{agent.name} <span className="text-xs text-muted-foreground">· {agent.role}</span></p><p className="text-xs text-muted-foreground">{agent.extension ? `Extensión ${agent.extension}` : 'Sin extensión configurada'}</p></div>
              {agent.in_call && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-500"><PhoneCall className="size-3" />En llamada</span>}
              <span className="text-sm text-muted-foreground">{agent.open_conversations} chats abiertos</span>
              {agent.negative_conversations > 0 && <><span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive"><AlertTriangle className="size-3" />{agent.negative_conversations} crítico{agent.negative_conversations === 1 ? '' : 's'}</span><Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={takingFollowUp === agent.id} onClick={() => void takeFollowUp(agent)}>{takingFollowUp === agent.id ? <Loader2 className="size-3.5 animate-spin" /> : 'Tomar seguimiento'}</Button></>}
            </div>
          ))}
        </div>
      ) : <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No hay miembros en esta cuenta.</p>}
    </section>
  )
}

function Metric({ label, value, tone }: { label: string; value: number; tone: 'success' | 'primary' | 'danger' }) {
  const valueClass = tone === 'success' ? 'text-emerald-500' : tone === 'danger' ? 'text-destructive' : 'text-primary'
  const borderClass = tone === 'danger' ? 'border-destructive/30' : 'border-border'
  return <div className={`rounded-lg border p-3 text-sm ${borderClass}`}><p className="text-muted-foreground">{label}</p><p className={`mt-1 text-2xl font-semibold ${valueClass}`}>{value}</p></div>
}
