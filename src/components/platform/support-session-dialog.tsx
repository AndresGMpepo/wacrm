'use client'

import { useCallback, useEffect, useState } from 'react'
import { LifeBuoy, LoaderCircle, ShieldAlert, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type SupportSession = { id: string; reason: string; expires_at: string; created_at: string }

type Overview = {
  account: { id: string; name: string; created_at: string }
  totals: { contacts: number; open_conversations: number; conversations_last_7d: number }
  conversations_by_channel: Record<string, number>
  connectors: { id: string; provider: string; display_name: string; status: string; last_event_at: string | null; last_error: string | null }[]
  queues: { id: string; name: string; is_default: boolean; mode: string }[]
  whatsapp: { phone_number_id: string; status: string; connected_at: string | null } | null
  ai: {
    provider: string
    model: string
    is_active: boolean
    auto_reply_enabled: boolean
    conversation_analysis_enabled: boolean
    handoff_target: string | null
    channel_types: string[] | null
    analysis_auto_route_enabled: boolean
  } | null
  automations: { id: string; name: string; trigger_type: string; is_active: boolean; execution_count: number; last_executed_at: string | null }[]
  flows: { id: string; name: string; is_active: boolean }[]
  recent_errors: { event_type: number | string; detail: string | null; received_at: string | null }[]
}

/**
 * Support console for one tenant. Access is a time-boxed session with a
 * stated reason; the snapshot deliberately holds no message bodies, contact
 * identities or secrets — enough to diagnose, not to read the customer's
 * conversations.
 */
export function SupportSessionDialog({
  accountId,
  accountName,
  open,
  onOpenChange,
}: {
  accountId: string
  accountName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [session, setSession] = useState<SupportSession | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [reason, setReason] = useState('')
  const [minutes, setMinutes] = useState(60)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)

  const loadOverview = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/platform/accounts/${accountId}/support/overview`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setOverview(null)
        return
      }
      setOverview(body as Overview)
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    if (!open) return
    void (async () => {
      const res = await fetch(`/api/platform/accounts/${accountId}/support`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      const active = (body?.session ?? null) as SupportSession | null
      setSession(active)
      if (active) await loadOverview()
    })()
  }, [open, accountId, loadOverview])

  async function start() {
    setBusy(true)
    try {
      const res = await fetch(`/api/platform/accounts/${accountId}/support`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason, minutes }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body?.error ?? 'No se pudo iniciar la sesión de soporte.')
        return
      }
      setSession(body.session)
      setReason('')
      await loadOverview()
    } finally {
      setBusy(false)
    }
  }

  async function end() {
    setBusy(true)
    try {
      await fetch(`/api/platform/accounts/${accountId}/support`, { method: 'DELETE' })
      setSession(null)
      setOverview(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LifeBuoy className="size-4" />
            Soporte · {accountName}
          </DialogTitle>
          <DialogDescription>
            El acceso queda registrado en la auditoría de la cuenta y caduca solo.
          </DialogDescription>
        </DialogHeader>

        {!session ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <p>
                Estás por revisar datos operativos de un cliente. Indica el motivo: quedará guardado junto a tu correo y
                a cada consulta que hagas.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="support-reason">Motivo</Label>
              <Input
                id="support-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ticket #482 — la automatización no responde en Instagram"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="support-minutes">Duración (minutos)</Label>
              <Input
                id="support-minutes"
                type="number"
                min={5}
                max={480}
                value={minutes}
                onChange={(e) => setMinutes(Math.min(480, Math.max(5, Number(e.target.value) || 60)))}
                className="w-28"
              />
            </div>
            <DialogFooter>
              <Button onClick={() => void start()} disabled={busy || reason.trim().length < 3}>
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                Iniciar sesión de soporte
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
              <span className="text-muted-foreground">
                Motivo: <span className="text-foreground">{session.reason}</span> · caduca{' '}
                {new Date(session.expires_at).toLocaleString()}
              </span>
              <Button variant="outline" size="sm" onClick={() => void end()} disabled={busy}>
                Cerrar sesión de soporte
              </Button>
            </div>

            {loading ? (
              <div className="flex justify-center py-8">
                <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : overview ? (
              <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
                <div className="grid grid-cols-3 gap-2">
                  <Metric label="Contactos" value={overview.totals.contacts} />
                  <Metric label="Conversaciones abiertas" value={overview.totals.open_conversations} />
                  <Metric label="Actividad 7 días" value={overview.totals.conversations_last_7d} />
                </div>

                <Section title="Canales conectados">
                  {overview.connectors.length === 0 && !overview.whatsapp ? (
                    <Empty>Sin canales configurados.</Empty>
                  ) : (
                    <ul className="space-y-1">
                      {overview.whatsapp ? (
                        <Row
                          title={`WhatsApp directo · ${overview.whatsapp.phone_number_id}`}
                          status={overview.whatsapp.status}
                        />
                      ) : null}
                      {overview.connectors.map((c) => (
                        <Row
                          key={c.id}
                          title={`${c.provider} · ${c.display_name}`}
                          status={c.status}
                          detail={c.last_error ?? (c.last_event_at ? `Último evento ${new Date(c.last_event_at).toLocaleString()}` : null)}
                        />
                      ))}
                    </ul>
                  )}
                </Section>

                <Section title="Agente de IA">
                  {overview.ai ? (
                    <p className="text-xs text-muted-foreground">
                      {overview.ai.provider} · {overview.ai.model} · maestro{' '}
                      {overview.ai.is_active ? 'activo' : 'apagado'} · respuesta automática{' '}
                      {overview.ai.auto_reply_enabled ? 'activa' : 'apagada'} · análisis{' '}
                      {overview.ai.conversation_analysis_enabled ? 'activo' : 'apagado'} · transferencia{' '}
                      {overview.ai.handoff_target ?? 'agent'} · canales{' '}
                      {overview.ai.channel_types?.join(', ') ?? 'todos'}
                    </p>
                  ) : (
                    <Empty>La cuenta no tiene IA configurada.</Empty>
                  )}
                </Section>

                <Section title="Colas">
                  {overview.queues.length === 0 ? (
                    <Empty>Sin colas.</Empty>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {overview.queues.map((q) => `${q.name} (${q.mode}${q.is_default ? ', predeterminada' : ''})`).join(' · ')}
                    </p>
                  )}
                </Section>

                <Section title="Automatizaciones y flujos">
                  {overview.automations.length === 0 && overview.flows.length === 0 ? (
                    <Empty>Sin automatizaciones ni flujos.</Empty>
                  ) : (
                    <ul className="space-y-1">
                      {overview.automations.map((a) => (
                        <Row
                          key={a.id}
                          title={`${a.name} · ${a.trigger_type}`}
                          status={a.is_active ? 'activa' : 'borrador'}
                          detail={`${a.execution_count} ejecuciones${a.last_executed_at ? ` · última ${new Date(a.last_executed_at).toLocaleString()}` : ''}`}
                        />
                      ))}
                      {overview.flows.map((f) => (
                        <Row key={f.id} title={`Flujo · ${f.name}`} status={f.is_active ? 'activo' : 'borrador'} />
                      ))}
                    </ul>
                  )}
                </Section>

                <Section title="Errores recientes de canales">
                  {overview.recent_errors.length === 0 ? (
                    <Empty>Sin errores registrados.</Empty>
                  ) : (
                    <ul className="space-y-1">
                      {overview.recent_errors.map((e, i) => (
                        <li key={i} className="flex gap-2 rounded-md bg-red-500/5 px-2 py-1 text-xs text-red-400">
                          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                          <span className="break-words">
                            {e.received_at ? `${new Date(e.received_at).toLocaleString()} · ` : ''}
                            {e.detail ?? `evento ${e.event_type}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              </div>
            ) : (
              <Empty>No se pudo cargar el panorama de la cuenta.</Empty>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold text-foreground">{value}</p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-foreground">{title}</p>
      {children}
    </div>
  )
}

function Row({ title, status, detail }: { title: string; status?: string; detail?: string | null }) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 rounded-md border border-border bg-muted/20 px-2 py-1 text-xs">
      <span className="text-foreground">{title}</span>
      {status ? (
        <span className="rounded-full border border-border px-1.5 text-[10px] text-muted-foreground">{status}</span>
      ) : null}
      {detail ? <span className="w-full break-words text-[11px] text-muted-foreground">{detail}</span> : null}
    </li>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>
}
