'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Copy, Loader2, MessageCircle, Save } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Connector = {
  id: string
  displayName: string
  channelId: string
  status: 'configured' | 'active' | 'paused' | 'error'
  webhookConfigured: boolean
  webhookUrl: string | null
  lastEventAt: string | null
  lastError: string | null
}

export function YeastarLiveChatConfig() {
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [displayName, setDisplayName] = useState('Chat web')
  const [channelId, setChannelId] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')

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
        body: JSON.stringify({ displayName, channelId, webhookSecret }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'No se pudo guardar el canal.')
      setWebhookSecret('')
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

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MessageCircle className="size-5" />Chat web de Yeastar</CardTitle>
        <CardDescription>Prepara el canal de Live Chat para que sus conversaciones entren a la misma bandeja, reglas de asignación, alertas e IA de WACRM.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={save} className="grid gap-4 rounded-lg border p-4 md:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="yeastar-chat-name">Nombre visible</Label><Input id="yeastar-chat-name" maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} required disabled={saving} /></div>
          <div className="space-y-2"><Label htmlFor="yeastar-chat-id">ID del canal Live Chat</Label><Input id="yeastar-chat-id" maxLength={128} value={channelId} onChange={(event) => setChannelId(event.target.value)} placeholder="ID mostrado por Yeastar" required disabled={saving} /></div>
          <div className="space-y-2 md:col-span-2"><Label htmlFor="yeastar-chat-secret">Secreto del webhook</Label><Input id="yeastar-chat-secret" type="password" value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} placeholder="El mismo secreto configurado en el webhook 30031 de Yeastar" disabled={saving} /><p className="text-xs text-muted-foreground">Se cifra en el servidor. Si el canal ya existe, déjalo vacío para conservar el secreto actual.</p></div>
          <div className="md:col-span-2"><Button type="submit" disabled={saving || !displayName.trim() || !channelId.trim()}>{saving ? <Loader2 className="animate-spin" /> : <Save />}Guardar canal</Button></div>
        </form>

        <div className="rounded-lg border border-primary/25 bg-primary/5 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Configuración en Yeastar</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Crea o identifica tu canal de Live Chat y copia su ID.</li>
            <li>En Integraciones → API agrega un webhook POST para el evento <strong>30031: New Message Notification</strong>.</li>
            <li>Pega la URL generada abajo y usa el mismo secreto en ambos sistemas.</li>
            <li>Configura el destino de mensajes del canal hacia la plataforma de analítica/API de terceros.</li>
          </ol>
        </div>

        {loading ? <div className="flex justify-center py-5"><Loader2 className="animate-spin text-muted-foreground" /></div> : connectors.length === 0 ? <p className="text-sm text-muted-foreground">Aún no hay canales Live Chat configurados.</p> : <div className="space-y-3">{connectors.map((connector) => <div key={connector.id} className="rounded-lg border p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-medium">{connector.displayName}</p><p className="text-sm text-muted-foreground">Canal Yeastar: {connector.channelId}</p></div><p className="flex items-center gap-1.5 text-sm text-amber-500"><CheckCircle2 className="size-4" />{connector.webhookConfigured ? 'Configurado — pendiente de recibir evento' : 'Falta secreto de webhook'}</p></div><div className="mt-3 flex gap-2"><Input readOnly value={connector.webhookUrl ?? 'Define NEXT_PUBLIC_SITE_URL para generar la URL'} /><Button type="button" size="icon" variant="outline" onClick={() => void copy(connector.webhookUrl)} disabled={!connector.webhookUrl} aria-label="Copiar URL del webhook"><Copy className="size-4" /></Button></div>{connector.lastError ? <p className="mt-2 text-xs text-destructive">Último error: {connector.lastError}</p> : null}</div>)}</div>}
      </CardContent>
    </Card>
  )
}
