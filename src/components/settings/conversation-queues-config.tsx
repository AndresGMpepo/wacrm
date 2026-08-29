'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/hooks/use-auth'

type Queue = { id: string; name: string; is_default: boolean; mode: 'round_robin' | 'least_open'; member_ids: string[] }
type Agent = { user_id: string; full_name: string }
type Source = { key: string; label: string; channel: string; queue_id: string | null }

export function ConversationQueuesConfig() {
  const { profile } = useAuth()
  const canManage = profile?.account_role === 'owner' || profile?.account_role === 'admin'
  const [queues, setQueues] = useState<Queue[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [newQueueName, setNewQueueName] = useState('')
  const [creating, setCreating] = useState(false)
  const [savingQueueId, setSavingQueueId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/conversations/queues', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error)
      setQueues(payload.queues ?? [])
      setAgents(payload.agents ?? [])
      setSources(payload.sources ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar las colas.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])

  const createQueue = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!newQueueName.trim()) return
    setCreating(true)
    try {
      const response = await fetch('/api/conversations/queues', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newQueueName.trim() }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error)
      toast.success('Cola creada.')
      setNewQueueName('')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear la cola.')
    } finally {
      setCreating(false)
    }
  }

  const updateQueue = async (id: string, patch: { name?: string; mode?: 'round_robin' | 'least_open'; member_ids?: string[] }) => {
    setSavingQueueId(id)
    try {
      const response = await fetch('/api/conversations/queues', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la cola.')
    } finally {
      setSavingQueueId(null)
    }
  }

  const deleteQueue = async (queue: Queue) => {
    if (!window.confirm(`¿Eliminar la cola "${queue.name}"? Los orígenes que la usaban volverán a la cola General.`)) return
    try {
      const response = await fetch(`/api/conversations/queues?id=${encodeURIComponent(queue.id)}`, { method: 'DELETE' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error)
      toast.success('Cola eliminada.')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo eliminar la cola.')
    }
  }

  const toggleMember = (queue: Queue, userId: string) => {
    const memberIds = queue.member_ids.includes(userId) ? queue.member_ids.filter((id) => id !== userId) : [...queue.member_ids, userId]
    void updateQueue(queue.id, { member_ids: memberIds })
  }

  const setSourceQueue = async (key: string, queueId: string) => {
    try {
      const response = await fetch('/api/conversations/queues/sources', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, queue_id: queueId || null }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el origen.')
    }
  }

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Users className="size-4" /> Colas especializadas</CardTitle>
        <CardDescription>Crea colas (ej. Soporte, Ventas), asigna agentes a cada una, y decide qué número de WhatsApp o canal conectado enruta sus conversaciones nuevas a cada cola. Un canal sin cola asignada usa la cola General (todos los agentes activos, igual que hoy).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {canManage ? (
          <form className="flex gap-2" onSubmit={createQueue}>
            <Input value={newQueueName} onChange={(event) => setNewQueueName(event.target.value)} placeholder="Nombre de la nueva cola (ej. Soporte)" className="max-w-xs" />
            <Button type="submit" variant="outline" disabled={creating}><Plus className="size-4" />Crear cola</Button>
          </form>
        ) : null}

        <div className="space-y-3">
          {queues.map((queue) => (
            <div key={queue.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={queue.name}
                    disabled={!canManage || queue.is_default}
                    onChange={(event) => setQueues((current) => current.map((item) => item.id === queue.id ? { ...item, name: event.target.value } : item))}
                    onBlur={(event) => { if (event.target.value.trim() && event.target.value.trim() !== queue.name) void updateQueue(queue.id, { name: event.target.value.trim() }) }}
                    className="h-8 w-48"
                  />
                  {queue.is_default ? <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">General</span> : null}
                  {savingQueueId === queue.id ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={queue.mode}
                    disabled={!canManage}
                    onChange={(event) => void updateQueue(queue.id, { mode: event.target.value as 'round_robin' | 'least_open' })}
                    className="border-input h-8 rounded-lg border bg-transparent px-2 text-xs"
                  >
                    <option value="round_robin">Rotación equitativa</option>
                    <option value="least_open">Menor carga activa</option>
                  </select>
                  {!queue.is_default && canManage ? <Button type="button" size="icon" variant="ghost" onClick={() => void deleteQueue(queue)}><Trash2 className="size-4 text-destructive" /></Button> : null}
                </div>
              </div>
              <div className="mt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Agentes en esta cola{queue.is_default && !queue.member_ids.length ? ' (vacío = todos los agentes activos)' : ''}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {agents.map((agent) => {
                    const active = queue.member_ids.includes(agent.user_id)
                    return (
                      <button
                        key={agent.user_id}
                        type="button"
                        disabled={!canManage}
                        onClick={() => toggleMember(queue, agent.user_id)}
                        className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}
                      >
                        {agent.full_name || 'Agente sin nombre'}
                      </button>
                    )
                  })}
                  {agents.length === 0 ? <p className="text-xs text-muted-foreground">No hay agentes activos en esta cuenta.</p> : null}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div>
          <p className="text-sm font-medium text-foreground">Enrutamiento por canal</p>
          <p className="mt-1 text-xs text-muted-foreground">Elige a qué cola entran las conversaciones nuevas de cada número/canal conectado.</p>
          <div className="mt-2 space-y-2">
            {sources.length === 0 ? <p className="text-xs text-muted-foreground">No hay canales conectados todavía.</p> : sources.map((source) => (
              <div key={source.key} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                <span className="text-sm text-foreground">{source.label}</span>
                <select
                  value={source.queue_id ?? ''}
                  disabled={!canManage}
                  onChange={(event) => void setSourceQueue(source.key, event.target.value)}
                  className="border-input h-8 rounded-lg border bg-transparent px-2 text-xs"
                >
                  <option value="">Cola General</option>
                  {queues.filter((queue) => !queue.is_default).map((queue) => (
                    <option key={queue.id} value={queue.id}>{queue.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        {!canManage ? <p className="text-xs text-muted-foreground">Solo el propietario o un administrador puede modificar las colas.</p> : null}
      </CardContent>
    </Card>
  )
}
