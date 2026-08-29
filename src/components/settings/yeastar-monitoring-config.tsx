'use client'

import { useCallback, useEffect, useState } from 'react'
import { Copy, Loader2, RefreshCw, Radio, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type WebhookReceipt = {
  event_type: string | null
  call_id: string | null
  outcome: 'processed' | 'ignored' | 'rejected' | 'invalid'
  detail: string | null
  received_at: string
}

type LastCallEndReceipt = {
  call_id: string | null
  outcome: 'processed' | 'ignored' | 'rejected' | 'invalid'
  detail: string | null
  received_at: string
} | null

export function YeastarMonitoringConfig() {
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [configured, setConfigured] = useState({ webhook: false, api: false })
  const [receipts, setReceipts] = useState<WebhookReceipt[]>([])
  const [lastCallEndReceipt, setLastCallEndReceipt] = useState<LastCallEndReceipt>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/telephony/yeastar/monitoring-config', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setWebhookUrl(data.webhookUrl ?? '')
      setConfigured({ webhook: Boolean(data.config?.webhookConfigured), api: Boolean(data.config?.apiConfigured) })
      setReceipts(data.receipts ?? [])
      setLastCallEndReceipt(data.lastCallEndReceipt ?? null)
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo cargar la supervisión Yeastar.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])
  const refresh = async () => { setRefreshing(true); try { await load() } finally { setRefreshing(false) } }
  const save = async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/telephony/yeastar/monitoring-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ webhookSecret, clientId, clientSecret }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setWebhookSecret(''); setClientId(''); setClientSecret('')
      toast.success('Supervisión Yeastar guardada.')
      await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar.') }
    finally { setSaving(false) }
  }
  const copy = async () => { try { await navigator.clipboard.writeText(webhookUrl); toast.success('URL copiada.') } catch { toast.error('No se pudo copiar la URL.') } }
  return <Card className="mt-6"><CardHeader><CardTitle className="flex items-center gap-2"><Radio className="size-4" /> Supervisión de llamadas Yeastar</CardTitle><CardDescription>Recibe eventos de llamadas activas en tiempo real. Las credenciales se cifran en el servidor y nunca se muestran otra vez.</CardDescription></CardHeader><CardContent className="space-y-4">
    <div className="space-y-2"><Label>URL del webhook NexoOmni</Label><div className="flex gap-2"><Input readOnly value={webhookUrl} /><Button type="button" size="icon" variant="outline" onClick={() => void copy()} disabled={!webhookUrl}><Copy className="size-4" /></Button></div></div>
    <div className="space-y-2"><Label htmlFor="yeastar-webhook-secret">Secreto del webhook</Label><Input id="yeastar-webhook-secret" type="password" value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} placeholder={configured.webhook ? 'Guardado — escribe solo para reemplazarlo' : 'Pega el secreto generado por Yeastar'} disabled={loading || saving} /><p className="text-xs text-muted-foreground">En Yeastar: Integraciones → API → Webhook Event Push. Usa POST, selecciona los eventos 30011 Call State Changed y 30012 Call End Details Notification en el mismo webhook, y pega aquí su secreto.</p></div>
    <div className="grid gap-4 md:grid-cols-2"><div className="space-y-2"><Label htmlFor="yeastar-api-client-id">Client ID OpenAPI</Label><Input id="yeastar-api-client-id" value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder={configured.api ? 'Guardado — opcional reemplazar' : 'Se usará después para Susurrar/Intervenir'} disabled={loading || saving} /></div><div className="space-y-2"><Label htmlFor="yeastar-api-client-secret">Client Secret OpenAPI</Label><Input id="yeastar-api-client-secret" type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder={configured.api ? 'Guardado — opcional reemplazar' : 'Se usará después para Susurrar/Intervenir'} disabled={loading || saving} /></div></div>
    <p className="rounded-md border border-primary/25 bg-primary/8 p-3 text-xs text-muted-foreground">Estado: webhook {configured.webhook ? 'configurado' : 'pendiente'} · OpenAPI {configured.api ? 'configurada' : 'pendiente'}.</p>
    <div className="rounded-md border p-3 text-xs">
      <p className="font-medium text-foreground">Diagnóstico: último evento 30012 (fin de llamada / transcripción)</p>
      {lastCallEndReceipt ? <p className={`mt-1 ${lastCallEndReceipt.outcome === 'processed' ? 'text-emerald-500' : lastCallEndReceipt.outcome === 'rejected' || lastCallEndReceipt.outcome === 'invalid' ? 'text-destructive' : 'text-muted-foreground'}`}>
        {new Date(lastCallEndReceipt.received_at).toLocaleString()} · {lastCallEndReceipt.detail ?? 'Sin detalle'}
      </p> : <p className="mt-1 text-destructive">Nunca se ha recibido un evento 30012 para esta cuenta. Revisa en Yeastar que “Call End Details Notification (30012)” esté marcado en el mismo webhook que 30011, apuntando a esta misma URL.</p>}
    </div>
    <div className="rounded-md border p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-foreground">Diagnóstico de eventos recibidos</p>
        <Button type="button" size="icon" variant="ghost" title="Actualizar" onClick={() => void refresh()} disabled={refreshing}><RefreshCw className={refreshing ? 'size-3.5 animate-spin' : 'size-3.5'} /></Button>
      </div>
      <p className="mt-1 text-muted-foreground">Haz una llamada activa y pulsa Guardar supervisión o recarga esta sección. El envío de prueba de Yeastar puede aparecer como “ignorado”; eso solo valida la conectividad.</p>
      {receipts.length ? <div className="mt-3 space-y-2">
        {receipts.map((item, index) => <p key={`${item.received_at}-${index}`} className={item.outcome === 'processed' ? 'text-emerald-500' : item.outcome === 'rejected' || item.outcome === 'invalid' ? 'text-destructive' : 'text-muted-foreground'}>
          {item.outcome === 'processed' ? 'Procesado' : item.outcome === 'rejected' ? 'Rechazado' : item.outcome === 'invalid' ? 'Inválido' : 'Ignorado'} · {new Date(item.received_at).toLocaleString()} · {item.detail ?? 'Sin detalle'}
        </p>)}
      </div> : <p className="mt-3 text-muted-foreground">Aún no hay eventos registrados.</p>}
    </div>
    <Button onClick={() => void save()} disabled={loading || saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}Guardar supervisión</Button>
  </CardContent></Card>
}
