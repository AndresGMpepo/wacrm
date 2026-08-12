'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Copy, Loader2, MessageCircle, Pause, Play, RefreshCw, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Connector = {
  id: string
  displayName: string
  channelId: string
  sourceUrl: string | null
  status: 'configured' | 'active' | 'paused' | 'error'
  webhookConfigured: boolean
  outboundConfigured: boolean
  outboundPbxUrl: string | null
  sessionPolicy: { autoClose: boolean; timeout: number | null; unit: string | null; syncedAt: string | null } | null
  webhookUrl: string | null
  lastEventAt: string | null
  lastError: string | null
}

function connectorState(connector: Connector) {
  if (!connector.webhookConfigured) return { label: 'Falta secreto de webhook', className: 'text-destructive' }
  if (connector.status === 'active') return { label: 'Activo — recibe eventos de Yeastar', className: 'text-emerald-500' }
  if (connector.status === 'error') return { label: 'Revisar el último evento', className: 'text-destructive' }
  if (connector.status === 'paused') return { label: 'Pausado', className: 'text-amber-500' }
  return { label: 'Configurado — pendiente de recibir evento', className: 'text-amber-500' }
}

export function YeastarLiveChatConfig() {
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [displayName, setDisplayName] = useState('Chat web')
  const [channelId, setChannelId] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [outboundPbxUrl, setOutboundPbxUrl] = useState('')
  const [outboundClientId, setOutboundClientId] = useState('')
  const [outboundClientSecret, setOutboundClientSecret] = useState('')
  const [syncingConnectorId, setSyncingConnectorId] = useState<string | null>(null)
  const [managingConnectorId, setManagingConnectorId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/omnichannel/yeastar-live-chat', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'No se pudo cargar el canal.')
      setConnectors(payload.connectors ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar el canal.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const response = await fetch('/api/omnichannel/yeastar-live-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, channelId, sourceUrl, webhookSecret, outboundPbxUrl, outboundClientId, outboundClientSecret }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'No se pudo guardar el canal.')
      setWebhookSecret('')
      setOutboundClientSecret('')
      toast.success(payload.message ?? 'Canal guardado.')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el canal.')
    } finally {
      setSaving(false)
    }
  }

  const copy = async (value: string | null) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      toast.success('URL copiada.')
    } catch {
      toast.error('No se pudo copiar la URL.')
    }
  }

  const syncPolicy = async (connectorId: string) => {
    setSyncingConnectorId(connectorId)
    try {
      const response = await fetch(`/api/omnichannel/yeastar-live-chat/${connectorId}/session-policy`, { method: 'POST' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'No se pudo sincronizar la política.')
      const media = payload.capabilities?.images ? 'Imágenes: habilitadas.' : 'Imágenes: revisa “Tipos de mensajes” en Yeastar.'
      const calls = payload.capabilities?.webrtcInboundCalls
        ? `Llamadas WebRTC: habilitadas (ruta ${payload.capabilities.webRtcInboundRouteId}).`
        : 'Llamadas WebRTC: incompletas; activa Llamadas y chat, WebRTC entrante, troncal y ruta en Yeastar.'
      toast.success(`${payload.policy?.autoClose ? 'Cierre sincronizado.' : 'Sin cierre automático.'} ${media} ${calls}`)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo sincronizar la política.')
    } finally {
      setSyncingConnectorId(null)
    }
  }

  const setConnectorState = async (connector: Connector, action: 'pause' | 'resume') => {
    setManagingConnectorId(connector.id)
    try {
      const response = await fetch(`/api/omnichannel/yeastar-live-chat/${connector.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'No se pudo actualizar el canal.')
      toast.success(payload.message ?? (action === 'pause' ? 'Canal pausado.' : 'Canal reactivado.'))
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el canal.')
    } finally {
      setManagingConnectorId(null)
    }
  }

  const removeConnector = async (connector: Connector) => {
    const approved = window.confirm(`¿Eliminar la integración “${connector.displayName}” de NexoOmni?\n\nNo se borrará el canal de Yeastar ni el historial ya recibido. La URL del webhook dejará de aceptar mensajes hasta que configures un canal nuevo.`)
    if (!approved) return

    setManagingConnectorId(connector.id)
    try {
      const response = await fetch(`/api/omnichannel/yeastar-live-chat/${connector.id}`, { method: 'DELETE' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'No se pudo eliminar el canal.')
      toast.success(payload.message ?? 'Integración eliminada de NexoOmni.')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo eliminar el canal.')
    } finally {
      setManagingConnectorId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MessageCircle className="size-5" />Chat web de Yeastar</CardTitle>
        <CardDescription>Prepara el canal de Live Chat para que sus conversaciones entren a la misma bandeja, reglas de asignación, alertas e IA de NexoOmni.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={save} className="grid gap-4 rounded-lg border p-4 md:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="yeastar-chat-name">Nombre visible del canal</Label><Input id="yeastar-chat-name" maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Ventas sitio web" required disabled={saving} /><p className="text-xs text-muted-foreground">Este nombre aparecerá en la bandeja y los reportes.</p></div>
          <div className="space-y-2"><Label htmlFor="yeastar-chat-id">ID del canal Live Chat</Label><Input id="yeastar-chat-id" maxLength={128} value={channelId} onChange={(event) => setChannelId(event.target.value)} placeholder="ID mostrado por Yeastar" required disabled={saving} /></div>
          <div className="space-y-2 md:col-span-2"><Label htmlFor="yeastar-chat-source-url">Página o portal de origen</Label><Input id="yeastar-chat-source-url" type="url" maxLength={500} value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://empresa.com/ventas" disabled={saving} /><p className="text-xs text-muted-foreground">Opcional. Registra dónde está instalado este widget: sitio de ventas, portal de tickets o micrositio.</p></div>
          <div className="space-y-2 md:col-span-2"><Label htmlFor="yeastar-chat-secret">Secreto del webhook</Label><Input id="yeastar-chat-secret" type="password" value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} placeholder="El mismo secreto configurado en el webhook 30031 de Yeastar" disabled={saving} /><p className="text-xs text-muted-foreground">Se cifra en el servidor. Si el canal ya existe, déjalo vacío para conservar el secreto actual.</p></div>
          <div className="space-y-2 md:col-span-2"><Label htmlFor="yeastar-chat-pbx-url">URL del PBX para responder</Label><Input id="yeastar-chat-pbx-url" type="url" value={outboundPbxUrl} onChange={(event) => setOutboundPbxUrl(event.target.value)} placeholder="https://neose.ras.yeastar.com" disabled={saving} /><p className="text-xs text-muted-foreground">Recomendado cuando este chat vive en un PBX distinto al softphone. Se usa únicamente para responder este canal.</p></div>
          <div className="space-y-2"><Label htmlFor="yeastar-chat-client-id">Client ID OpenAPI</Label><Input id="yeastar-chat-client-id" value={outboundClientId} onChange={(event) => setOutboundClientId(event.target.value)} placeholder="Usuario OpenAPI del PBX" disabled={saving} /></div>
          <div className="space-y-2"><Label htmlFor="yeastar-chat-client-secret">Client Secret OpenAPI</Label><Input id="yeastar-chat-client-secret" type="password" value={outboundClientSecret} onChange={(event) => setOutboundClientSecret(event.target.value)} placeholder="Contraseña OpenAPI del PBX" disabled={saving} /><p className="text-xs text-muted-foreground">Las tres credenciales se cifran y nunca se vuelven a mostrar.</p></div>
          <div className="md:col-span-2"><Button type="submit" disabled={saving || !displayName.trim() || !channelId.trim()}>{saving ? <Loader2 className="animate-spin" /> : <Save />}Guardar canal</Button></div>
        </form>

        <div className="rounded-lg border border-primary/25 bg-primary/5 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Configuración en Yeastar</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Crea o identifica un canal de Live Chat por cada widget o página y copia su ID.</li>
            <li>En Integraciones → API agrega un webhook POST para el evento <strong>30031: New Message Notification</strong>.</li>
            <li>Pega la URL generada abajo y usa el mismo secreto en ambos sistemas. Cada canal debe usar su propia URL de NexoOmni.</li>
            <li>Configura el destino de mensajes del canal hacia la plataforma de analítica/API de terceros.</li>
          </ol>
        </div>

        {loading ? <div className="flex justify-center py-5"><Loader2 className="animate-spin text-muted-foreground" /></div> : connectors.length === 0 ? <p className="text-sm text-muted-foreground">Aún no hay canales Live Chat configurados.</p> : <div className="space-y-3">{connectors.map((connector) => { const state = connectorState(connector); const policy = connector.sessionPolicy; const policyText = !policy ? 'Pendiente de sincronizar' : !policy.autoClose ? 'Sin cierre automático' : `Cierra tras ${policy.timeout} ${policy.unit === 'day' ? 'día(s)' : policy.unit === 'hour' ? 'hora(s)' : 'minuto(s)'} sin actividad`; const busy = syncingConnectorId === connector.id || managingConnectorId === connector.id; return <div key={connector.id} className="rounded-lg border p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-medium">{connector.displayName}</p><p className="text-sm text-muted-foreground">Canal Yeastar: {connector.channelId}</p><p className="mt-1 break-all text-xs text-muted-foreground">Origen: {connector.sourceUrl ?? 'No indicado'}</p><p className="mt-1 text-xs text-muted-foreground">Salida OpenAPI: {connector.outboundConfigured ? `configurada (${connector.outboundPbxUrl})` : 'usa la configuración global de Telefonía'}</p><p className="mt-1 text-xs text-muted-foreground">Sesión: {policyText}</p></div><p className={`flex items-center gap-1.5 text-sm ${state.className}`}><CheckCircle2 className="size-4" />{state.label}</p></div><div className="mt-3 flex flex-wrap gap-2"><Input className="min-w-0 flex-1" readOnly value={connector.webhookUrl ?? 'Define NEXT_PUBLIC_SITE_URL para generar la URL'} /><Button type="button" size="icon" variant="outline" onClick={() => void copy(connector.webhookUrl)} disabled={!connector.webhookUrl || busy} aria-label="Copiar URL del webhook"><Copy className="size-4" /></Button><Button type="button" variant="outline" onClick={() => void syncPolicy(connector.id)} disabled={busy}><RefreshCw className={syncingConnectorId === connector.id ? 'animate-spin' : ''} />Verificar conexión</Button>{connector.status === 'paused' ? <Button type="button" variant="outline" onClick={() => void setConnectorState(connector, 'resume')} disabled={busy}><Play />Reactivar</Button> : <Button type="button" variant="outline" onClick={() => void setConnectorState(connector, 'pause')} disabled={busy}><Pause />Pausar</Button>}<Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void removeConnector(connector)} disabled={busy}><Trash2 />Eliminar</Button></div>{policy?.syncedAt ? <p className="mt-2 text-xs text-muted-foreground">Política leída: {new Date(policy.syncedAt).toLocaleString('es-MX')}</p> : null}{connector.lastEventAt ? <p className="mt-2 text-xs text-muted-foreground">Último evento: {new Date(connector.lastEventAt).toLocaleString('es-MX')}</p> : null}{connector.lastError ? <p className="mt-2 text-xs text-destructive">Último error: {connector.lastError}</p> : null}</div> })}</div>}
      </CardContent>
    </Card>
  )
}
