'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Copy, Loader2, Pause, Play, RefreshCw, Save, Share2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Provider = 'facebook' | 'instagram'
type Connector = { id: string; provider: Provider; displayName: string; channelId: string; status: 'configured' | 'active' | 'paused' | 'error'; webhookConfigured: boolean; outboundConfigured: boolean; webhookUrl: string; lastEventAt: string | null; lastError: string | null }

function connectorState(connector: Connector) {
  if (!connector.webhookConfigured || !connector.outboundConfigured) return { label: 'Faltan credenciales Meta', className: 'text-destructive' }
  if (connector.status === 'active' && !connector.lastEventAt) return { label: 'Conexión validada — pendiente del primer evento', className: 'text-emerald-500' }
  if (connector.status === 'active') return { label: 'Activo — recibe mensajes Meta', className: 'text-emerald-500' }
  if (connector.status === 'paused') return { label: 'Pausado', className: 'text-amber-500' }
  if (connector.status === 'error') return { label: 'Revisar el último evento', className: 'text-destructive' }
  return { label: 'Configurado — pendiente de verificación', className: 'text-amber-500' }
}

export function MetaMessagingConfig() {
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [provider, setProvider] = useState<Provider>('facebook')
  const [displayName, setDisplayName] = useState('Facebook principal')
  const [channelId, setChannelId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [verifyToken, setVerifyToken] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/omnichannel/meta/connectors', { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'No se pudieron cargar los canales Meta.')
      setConnectors(data.connectors ?? [])
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los canales Meta.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true)
    try {
      const response = await fetch('/api/omnichannel/meta/connectors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, displayName, channelId, accessToken, appSecret, verifyToken }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'No se pudo guardar el canal Meta.')
      setAccessToken(''); setAppSecret(''); setVerifyToken('')
      toast.success(data.message ?? 'Canal Meta guardado.'); await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar el canal Meta.') }
    finally { setSaving(false) }
  }

  const manage = async (connector: Connector, action: 'pause' | 'resume' | 'delete' | 'validate') => {
    if (action === 'delete' && !window.confirm(`¿Eliminar “${connector.displayName}” de NexoOmni? El historial recibido permanece, pero también debes retirar la suscripción en Meta.`)) return
    setBusyId(connector.id)
    try {
      const url = action === 'validate'
        ? `/api/omnichannel/meta/connectors/${connector.id}/validate`
        : `/api/omnichannel/meta/connectors/${connector.id}`
      const response = await fetch(url, action === 'delete' ? { method: 'DELETE' } : action === 'validate' ? { method: 'POST' } : { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'No se pudo actualizar el canal.')
      toast.success(data.message ?? 'Canal actualizado.'); await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el canal.') }
    finally { setBusyId(null) }
  }

  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); toast.success('URL copiada.') } catch { toast.error('No se pudo copiar la URL.') } }
  const providerLabel = provider === 'facebook' ? 'Facebook Messenger' : 'Instagram Direct'

  return <Card>
    <CardHeader><CardTitle className="flex items-center gap-2"><Share2 className="size-5" />Facebook e Instagram</CardTitle><CardDescription>Conecta mensajes privados y comentarios públicos de Facebook e Instagram por empresa. Las credenciales se cifran en el servidor y nunca se muestran nuevamente.</CardDescription></CardHeader>
    <CardContent className="space-y-5">
      <form onSubmit={save} className="grid gap-4 rounded-lg border p-4 md:grid-cols-2">
        <div className="space-y-2"><Label>Canal</Label><Select value={provider} onValueChange={(value) => setProvider(value as Provider)} disabled={saving}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="facebook">Facebook Messenger</SelectItem><SelectItem value="instagram">Instagram Direct</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">Configura una integración por página de Facebook o cuenta profesional de Instagram.</p></div>
        <div className="space-y-2"><Label htmlFor="meta-name">Nombre visible</Label><Input id="meta-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} required disabled={saving} placeholder="Ventas Facebook" /></div>
        <div className="space-y-2"><Label htmlFor="meta-channel-id">{provider === 'facebook' ? 'ID de página Facebook' : 'ID de cuenta profesional Instagram'}</Label><Input id="meta-channel-id" name="meta-channel-id" autoComplete="off" value={channelId} onChange={(e) => setChannelId(e.target.value)} inputMode="numeric" required disabled={saving} placeholder="ID numérico mostrado por Meta" /></div>
        <div className="space-y-2"><Label htmlFor="meta-verify">Token de verificación</Label><Input id="meta-verify" type="password" value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} disabled={saving} placeholder="El mismo token que colocarás en Meta" /><p className="text-xs text-muted-foreground">En una edición déjalo vacío para conservar el token guardado.</p></div>
        <div className="space-y-2"><Label htmlFor="meta-token">Token de acceso</Label><Input id="meta-token" type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} required disabled={saving} placeholder="Page/Instagram access token" /><p className="text-xs text-muted-foreground">En una edición déjalo vacío para conservar el token guardado.</p></div>
        <div className="space-y-2"><Label htmlFor="meta-secret">App Secret</Label><Input id="meta-secret" type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} disabled={saving} placeholder="Secreto de la App de Meta" /><p className="text-xs text-muted-foreground">Firma cada webhook; no se usa el secreto de WhatsApp de otra empresa. En una edición puede quedar vacío.</p></div>
        <div className="md:col-span-2"><Button type="submit" disabled={saving || !displayName.trim() || !channelId.trim()}>{saving ? <Loader2 className="animate-spin" /> : <Save />}Guardar {providerLabel}</Button></div>
      </form>
      <div className="rounded-lg border border-primary/25 bg-primary/5 p-4 text-sm text-muted-foreground"><p className="font-medium text-foreground">Configuración en Meta</p><ol className="mt-2 list-decimal space-y-1 pl-5"><li>En tu App de Meta añade la URL de webhook mostrada abajo y el token de verificación de este canal.</li><li>Suscribe <strong>messages</strong> para Messenger y/o Instagram según corresponda. Para comentarios públicos, suscribe también <strong>feed</strong> en Facebook y <strong>comments</strong> en Instagram.</li><li>Asocia la página o cuenta profesional cuyo ID configuraste arriba.</li><li>Los comentarios entran a la bandeja como <strong>Comentario público</strong>. Un agente puede responder desde el mismo hilo; el análisis IA, QA, alertas y asignación se aplican como en los demás canales.</li><li>La respuesta automática pública de IA se mantiene desactivada por seguridad. Los mensajes salientes deben respetar las políticas de Meta.</li></ol></div>
      {loading ? <div className="flex justify-center py-5"><Loader2 className="animate-spin text-muted-foreground" /></div> : connectors.length === 0 ? <p className="text-sm text-muted-foreground">Aún no hay canales de Facebook o Instagram configurados.</p> : <div className="space-y-3">{connectors.map((connector) => { const state = connectorState(connector); const busy = busyId === connector.id; return <div key={connector.id} className="rounded-lg border p-4"><div className="flex flex-col gap-3 sm:flex-row sm:justify-between"><div><p className="flex items-center gap-2 font-medium"><Share2 className="size-4" />{connector.displayName}</p><p className="text-sm text-muted-foreground">{connector.provider === 'facebook' ? 'Facebook' : 'Instagram'} · {connector.channelId}</p></div><p className={`flex items-center gap-1.5 text-sm ${state.className}`}><CheckCircle2 className="size-4" />{state.label}</p></div><div className="mt-3 flex flex-wrap gap-2"><Input className="min-w-0 flex-1" readOnly value={connector.webhookUrl} /><Button type="button" size="icon" variant="outline" onClick={() => void copy(connector.webhookUrl)} disabled={busy} aria-label="Copiar URL webhook"><Copy className="size-4" /></Button>{connector.status === 'paused' ? <Button type="button" variant="outline" onClick={() => void manage(connector, 'resume')} disabled={busy}><Play />Reactivar</Button> : <><Button type="button" variant="outline" onClick={() => void manage(connector, 'validate')} disabled={busy}>{busy && busyId === connector.id ? <Loader2 className="animate-spin" /> : <RefreshCw />}Validar conexión</Button><Button type="button" variant="outline" onClick={() => void manage(connector, 'pause')} disabled={busy}><Pause />Pausar</Button></>}<Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void manage(connector, 'delete')} disabled={busy}><Trash2 />Eliminar</Button></div>{connector.lastEventAt ? <p className="mt-2 text-xs text-muted-foreground">Último evento: {new Date(connector.lastEventAt).toLocaleString('es-MX')}</p> : null}{connector.lastError ? <p className="mt-2 text-xs text-destructive">Último error: {connector.lastError}</p> : null}</div> })}</div>}
    </CardContent>
  </Card>
}
