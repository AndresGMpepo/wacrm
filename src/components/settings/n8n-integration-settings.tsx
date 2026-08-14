'use client'

import { useCallback, useEffect, useState } from 'react'
import { Copy, ExternalLink, Loader2, Pause, Play, Plus, Radio, Trash2, Webhook } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/use-auth'
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_DESCRIPTIONS, type WebhookEvent } from '@/lib/webhooks/events'

type Connection = {
  id: string
  name: string
  url: string
  events: WebhookEvent[]
  is_active: boolean
  last_delivery_at: string | null
  failure_count: number
  created_at: string
}

export function N8nIntegrationSettings({ onCreateApiKey }: { onCreateApiKey: () => void }) {
  const { canEditSettings } = useAuth()
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [form, setForm] = useState({ name: 'n8n principal', url: '', events: [...WEBHOOK_EVENTS] as WebhookEvent[] })

  const load = useCallback(async () => {
    if (!canEditSettings) {
      setLoading(false)
      return
    }
    try {
      const response = await fetch('/api/account/n8n-connections', { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'No se pudieron cargar las conexiones.')
      setConnections(payload.connections ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar las conexiones.')
    } finally {
      setLoading(false)
    }
  }, [canEditSettings])

  useEffect(() => { void load() }, [load])

  function toggleEvent(event: WebhookEvent, checked: boolean) {
    setForm((current) => ({
      ...current,
      events: checked ? [...current.events, event] : current.events.filter((item) => item !== event),
    }))
  }

  async function createConnection() {
    setSaving(true)
    try {
      const response = await fetch('/api/account/n8n-connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'No se pudo guardar la conexión.')
      setConnections((current) => [payload.connection as Connection, ...current])
      setSecret(payload.signing_secret as string)
      setCreating(false)
      setForm({ name: 'n8n principal', url: '', events: [...WEBHOOK_EVENTS] })
      toast.success('Conexión n8n creada.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la conexión.')
    } finally {
      setSaving(false)
    }
  }

  async function updateStatus(connection: Connection) {
    setBusyId(connection.id)
    try {
      const response = await fetch(`/api/account/n8n-connections/${connection.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !connection.is_active }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'No se pudo actualizar la conexión.')
      setConnections((current) => current.map((item) => item.id === connection.id ? { ...item, is_active: !item.is_active, failure_count: 0 } : item))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la conexión.')
    } finally { setBusyId(null) }
  }

  async function testConnection(connection: Connection) {
    setBusyId(connection.id)
    try {
      const response = await fetch(`/api/account/n8n-connections/${connection.id}`, { method: 'POST' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'No se pudo validar la conexión n8n.')
      toast.success(payload.message ?? 'Conexión n8n validada.')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo validar la conexión n8n.')
    } finally { setBusyId(null) }
  }

  async function removeConnection(connection: Connection) {
    if (!window.confirm(`¿Eliminar la conexión “${connection.name}”? n8n dejará de recibir eventos de esta cuenta.`)) return
    setBusyId(connection.id)
    try {
      const response = await fetch(`/api/account/n8n-connections/${connection.id}`, { method: 'DELETE' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'No se pudo eliminar la conexión.')
      setConnections((current) => current.filter((item) => item.id !== connection.id))
      toast.success('Conexión n8n eliminada.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo eliminar la conexión.')
    } finally { setBusyId(null) }
  }

  async function copy(value: string, message: string) {
    try { await navigator.clipboard.writeText(value); toast.success(message) } catch { toast.error('No se pudo copiar.') }
  }

  return (
    <Card className="border-primary/20 bg-primary/[0.03]">
      <CardHeader className="gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><Webhook className="size-5 text-primary" />Conecta n8n de forma segura</CardTitle>
          <CardDescription className="mt-1 max-w-3xl">Recibe eventos de NexoOmni en tu instancia externa de n8n. No necesitas crear credenciales JWT ni compartir la sesión de un agente.</CardDescription>
        </div>
        {canEditSettings ? <Button size="sm" onClick={() => setCreating(true)}><Plus className="size-4" />Conectar n8n</Button> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 rounded-lg border border-border bg-background/40 p-4 text-sm md:grid-cols-3">
          <div><p className="font-medium">1. En n8n crea un Webhook</p><p className="mt-1 text-xs text-muted-foreground">Usa un nodo <strong>Webhook</strong> con método POST, activa el flujo y copia su URL de producción. No uses JWT Auth ni crees credenciales.</p></div>
          <div><p className="font-medium">2. Conecta la URL aquí</p><p className="mt-1 text-xs text-muted-foreground">Pulsa “Conectar n8n”, pega la URL pública y selecciona los eventos que deseas recibir.</p></div>
          <div><p className="font-medium">3. Prueba la conexión</p><p className="mt-1 text-xs text-muted-foreground">Al guardar aparecerá “Probar conexión”. Envía un evento de prueba y no realiza acciones comerciales.</p></div>
        </div>
        <div className="rounded-lg border border-dashed bg-background/30 p-3 text-xs text-muted-foreground"><strong className="text-foreground">Clave API (opcional):</strong> sólo la necesitarás si un flujo de n8n debe consultar datos o enviar acciones a NexoOmni. En ese caso usa un nodo <strong>HTTP Request</strong> con el header <code>Authorization: Bearer TU_CLAVE</code>; no se configura en JWT Auth. <Button variant="link" className="h-auto px-1 text-xs" onClick={onCreateApiKey}>Crear clave opcional <ExternalLink className="size-3" /></Button></div>

        {loading ? <div className="flex justify-center py-4"><Loader2 className="size-5 animate-spin text-primary" /></div> : connections.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Aún no hay una conexión n8n. Crear una no instala n8n: sólo enlaza de forma segura la cuenta actual con tu instancia externa.</p> : <div className="divide-y rounded-lg border">{connections.map((connection) => <div key={connection.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{connection.name}</p><Badge className={connection.is_active ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' : 'border-border bg-muted text-muted-foreground'}>{connection.is_active ? 'Activa' : 'Pausada'}</Badge>{connection.failure_count > 0 ? <Badge variant="outline" className="text-amber-500">{connection.failure_count} fallo(s) consecutivo(s)</Badge> : null}</div><p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={connection.url}>{connection.url}</p><p className="mt-1 text-xs text-muted-foreground">Eventos: {connection.events.join(', ')}{connection.last_delivery_at ? ` · última entrega ${new Date(connection.last_delivery_at).toLocaleString('es-MX')}` : ' · sin entregas aún'}</p></div><div className="flex shrink-0 flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busyId === connection.id || !connection.is_active} onClick={() => void testConnection(connection)}>{busyId === connection.id ? <Loader2 className="size-4 animate-spin" /> : <Radio className="size-4" />}Probar conexión</Button><Button size="sm" variant="outline" disabled={busyId === connection.id} onClick={() => updateStatus(connection)}>{busyId === connection.id ? <Loader2 className="size-4 animate-spin" /> : connection.is_active ? <Pause className="size-4" /> : <Play className="size-4" />}{connection.is_active ? 'Pausar' : 'Reactivar'}</Button><Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={busyId === connection.id} onClick={() => removeConnection(connection)}><Trash2 className="size-4" />Eliminar</Button></div></div>)}</div>}
      </CardContent>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>Conectar una instancia n8n</DialogTitle><DialogDescription>Pega la URL de producción de un nodo <strong>Webhook</strong> de n8n. Debe estar activo y disponible por HTTPS desde Internet.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground"><strong className="text-foreground">Antes de guardar:</strong> en n8n crea un flujo con el nodo Webhook, selecciona <strong>POST</strong>, usa la <strong>Production URL</strong> y activa el flujo. No necesitas configurar JWT Auth, API key ni otra credencial para recibir esta prueba.</div>
            <div className="space-y-2"><Label htmlFor="n8n-name">Nombre de la conexión</Label><Input id="n8n-name" value={form.name} maxLength={80} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="n8n producción" /></div>
            <div className="space-y-2"><Label htmlFor="n8n-url">URL del Webhook de n8n</Label><Input id="n8n-url" type="url" value={form.url} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} placeholder="https://automatizaciones.empresa.com/webhook/nexoomni" /><p className="text-xs text-muted-foreground">No uses una URL de prueba de n8n: cambia cada vez que ejecutas el flujo manualmente.</p></div>
            <div className="space-y-2"><Label>Eventos que recibirá n8n</Label><div className="space-y-2 rounded-md border p-3">{WEBHOOK_EVENTS.map((event) => <label key={event} className="flex cursor-pointer gap-2.5 text-sm"><Checkbox checked={form.events.includes(event)} onCheckedChange={(checked) => toggleEvent(event, checked === true)} /><span><code className="text-xs">{event}</code><span className="mt-0.5 block text-xs text-muted-foreground">{WEBHOOK_EVENT_DESCRIPTIONS[event]}</span></span></label>)}</div></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCreating(false)}>Cancelar</Button><Button disabled={saving} onClick={createConnection}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Webhook className="size-4" />}Guardar conexión</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={secret !== null} onOpenChange={(open) => { if (!open) setSecret(null) }}>
        <DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Secreto de firma de NexoOmni</DialogTitle><DialogDescription>NexoOmni ya guardó una copia cifrada. La prueba de conexión funciona sin configurarlo en n8n; guárdalo sólo si después deseas validar la firma de cada evento.</DialogDescription></DialogHeader><div className="space-y-2"><Label>Secreto HMAC</Label><div className="flex gap-2"><Input readOnly value={secret ?? ''} className="font-mono text-xs" onFocus={(event) => event.currentTarget.select()} /><Button type="button" variant="outline" onClick={() => secret && void copy(secret, 'Secreto copiado.') }><Copy className="size-4" />Copiar</Button></div></div><div className="rounded-md border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-muted-foreground">Cada evento llega como JSON y contiene <code>id</code>, <code>event</code>, <code>occurred_at</code>, <code>account_id</code> y <code>data</code>. Para verificación avanzada, NexoOmni envía el header <code>X-NexoOmni-Signature</code>.</div><DialogFooter><Button onClick={() => setSecret(null)}>Continuar a la prueba</Button></DialogFooter></DialogContent>
      </Dialog>
    </Card>
  )
}
