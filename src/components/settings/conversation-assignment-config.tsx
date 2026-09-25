'use client'

import { useCallback, useEffect, useState } from 'react'
import { GitPullRequestArrow, Loader2, Save, ShieldCheck, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'
import { SettingsPanelHead } from './settings-panel-head'

type AssignmentMode = 'round_robin' | 'least_open'
type Agent = { user_id: string; full_name: string }

export function ConversationAssignmentConfig() {
  const { profile } = useAuth()
  const canManage = profile?.account_role === 'owner' || profile?.account_role === 'admin'
  const [enabled, setEnabled] = useState(false)
  const [mode, setMode] = useState<AssignmentMode>('round_robin')
  const [backupAgentId, setBackupAgentId] = useState<string>('')
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/conversations/assignment-policy', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error)
      setEnabled(Boolean(payload.policy?.enabled))
      setMode(payload.policy?.mode === 'least_open' ? 'least_open' : 'round_robin')
      setBackupAgentId(payload.policy?.backup_agent_id ?? '')
      setAgents(payload.agents ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar la política de asignación.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const save = async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/conversations/assignment-policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, mode, backup_agent_id: backupAgentId || null }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error)
      toast.success('Política de asignación guardada.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la política.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Asignación de conversaciones"
        description="Distribuye automáticamente los chats nuevos de WhatsApp entre agentes disponibles."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UsersRound className="size-4" /> Cola de conversaciones</CardTitle>
          <CardDescription>Solo considera miembros con rol de agente, administrador o propietario que estén en línea. Si no hay nadie disponible, el chat permanece en la bandeja sin asignar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
            <div>
              <p className="text-sm font-medium">Asignar automáticamente los chats nuevos</p>
              <p className="mt-1 text-xs text-muted-foreground">Aplica solo al crear una conversación entrante; nunca mueve conversaciones que ya tienen responsable.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} disabled={loading || saving || !canManage} />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Método de distribución</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <ModeCard
                icon={GitPullRequestArrow}
                title="Rotación equitativa"
                description="Alterna entre agentes en línea para repartir las conversaciones por turnos."
                active={mode === 'round_robin'}
                disabled={loading || saving || !enabled || !canManage}
                onClick={() => setMode('round_robin')}
              />
              <ModeCard
                icon={UsersRound}
                title="Menor carga activa"
                description="Envía el chat al agente en línea con menos conversaciones abiertas asignadas."
                active={mode === 'least_open'}
                disabled={loading || saving || !enabled || !canManage}
                onClick={() => setMode('least_open')}
              />
            </div>
          </div>

          <p className="rounded-md border border-emerald-500/25 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-400">La disponibilidad se valida con el pulso de sesión: ausente o desconectado significa que no recibe asignaciones automáticas.</p>

          <div className="space-y-2 rounded-lg border border-border p-4">
            <p className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="size-4" /> Enrutamiento continuo y agente de respaldo</p>
            <p className="text-xs text-muted-foreground">Un cliente que vuelve a escribir se asigna automáticamente al mismo agente que lo atendió antes. Si ese agente está inactivo, dado de baja o desconectado, el chat pasa al agente de respaldo configurado aquí.</p>
            <select
              value={backupAgentId}
              onChange={(event) => setBackupAgentId(event.target.value)}
              disabled={loading || saving || !canManage}
              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-55"
            >
              <option value="">Sin agente de respaldo</option>
              {agents.map((agent) => (
                <option key={agent.user_id} value={agent.user_id}>{agent.full_name}</option>
              ))}
            </select>
          </div>

          {!canManage ? <p className="text-xs text-muted-foreground">Solo el propietario o un administrador puede modificar esta política.</p> : null}

          <Button onClick={() => void save()} disabled={loading || saving || !canManage}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Guardar política
          </Button>
        </CardContent>
      </Card>
    </section>
  )
}

function ModeCard({
  icon: Icon,
  title,
  description,
  active,
  disabled,
  onClick,
}: {
  icon: typeof UsersRound
  title: string
  description: string
  active: boolean
  disabled: boolean
  onClick: () => void
}) {
  return <button type="button" onClick={onClick} disabled={disabled} className={cn('rounded-lg border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55', active ? 'border-primary bg-primary/8 ring-1 ring-primary/30' : 'border-border hover:bg-muted/50')}>
    <Icon className={cn('mb-3 size-5', active ? 'text-primary' : 'text-muted-foreground')} />
    <p className="text-sm font-semibold">{title}</p>
    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
  </button>
}
