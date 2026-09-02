'use client'

import { useCallback, useEffect, useState } from 'react'
import { Camera, CheckCircle2, ImageDown, Link2, Loader2, MessageCircle, MessagesSquare, Pause, Play, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type Channel = 'whatsapp' | 'facebook' | 'instagram'

type Connector = {
  id: string
  provider: string
  displayName: string
  externalChannelId: string
  status: 'configured' | 'active' | 'paused' | 'error'
  lastEventAt: string | null
  lastError: string | null
}

const CHANNELS: Record<Channel, { label: string; description: string; icon: typeof MessageCircle }> = {
  whatsapp: {
    label: 'Conectar WhatsApp',
    description: 'Autoriza un número de WhatsApp Business con el asistente de conexión.',
    icon: MessageCircle,
  },
  facebook: {
    label: 'Conectar Facebook',
    description: 'Autoriza Facebook Messenger y, si corresponde, los comentarios de la página.',
    icon: MessagesSquare,
  },
  instagram: {
    label: 'Conectar Instagram',
    description: 'Autoriza los mensajes de una cuenta profesional de Instagram.',
    icon: Camera,
  },
}

function connectorChannel(provider: string): Channel | null {
  if (provider === 'zernio_whatsapp') return 'whatsapp'
  if (provider === 'zernio_facebook') return 'facebook'
  if (provider === 'zernio_instagram') return 'instagram'
  return null
}

export function ZernioConnectConfig({ channels }: { channels: Channel[] }) {
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [configured, setConfigured] = useState(true)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/omnichannel/zernio/connectors', { cache: 'no-store' })
      if (!response.ok) throw new Error('No se pudieron cargar las conexiones.')
      const body = await response.json() as { connectors: Connector[]; configured?: boolean }
      setConnectors(body.connectors ?? [])
      setConfigured(body.configured !== false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar las conexiones.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const startConnect = (channel: Channel) => {
    setPending(`connect:${channel}`)
    window.location.assign(`/api/omnichannel/zernio/connect/${channel}`)
  }

  const manage = async (connector: Connector, action: 'pause' | 'resume' | 'delete') => {
    const isDelete = action === 'delete'
    if (isDelete && !window.confirm(`¿Eliminar la conexión ${connector.displayName}? Los mensajes ya guardados no se eliminarán.`)) return
    setPending(`${action}:${connector.id}`)
    try {
      const response = await fetch(`/api/omnichannel/zernio/connectors/${connector.id}`, {
        method: isDelete ? 'DELETE' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: isDelete ? undefined : JSON.stringify({ status: action === 'pause' ? 'paused' : 'configured' }),
      })
      const body = await response.json().catch(() => null) as { error?: string; warning?: string } | null
      if (!response.ok) throw new Error(body?.error ?? 'No se pudo actualizar la conexión.')
      if (body?.warning) {
        toast.warning(body.warning)
      } else {
        toast.success(isDelete ? 'Conexión eliminada.' : action === 'pause' ? 'Conexión pausada.' : 'Conexión reactivada.')
      }
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la conexión.')
    } finally {
      setPending(null)
    }
  }

  const syncAvatars = async (connector: Connector) => {
    setPending(`avatars:${connector.id}`)
    try {
      const response = await fetch('/api/omnichannel/zernio/avatars/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectorId: connector.id }),
      })
      const body = await response.json().catch(() => null) as { updated?: number; unavailable?: number; error?: string } | null
      if (!response.ok) throw new Error(body?.error ?? 'No se pudieron sincronizar las fotos.')
      toast.success(body?.updated ? `${body.updated} fotos de perfil sincronizadas.` : 'No hay fotos nuevas disponibles en este canal.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron sincronizar las fotos.')
    } finally {
      setPending(null)
    }
  }

  const relevant = connectors.filter((connector) => {
    const channel = connectorChannel(connector.provider)
    return channel !== null && channels.includes(channel)
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Link2 className="size-5 text-primary" /> Conexión rápida de canales</CardTitle>
        <CardDescription>
          Autoriza cada canal desde una guía externa segura. NexoOmni conserva la configuración por empresa y no expone las credenciales a los agentes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!loading && !configured && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            La conexión guiada no está disponible. El administrador debe configurar la clave del proveedor en el servidor.
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-3">
          {channels.map((channel) => {
            const item = CHANNELS[channel]
            const Icon = item.icon
            const isConnecting = pending === `connect:${channel}`
            return (
              <div key={channel} className="rounded-lg border border-border p-4">
                <Icon className="mb-3 size-5 text-primary" />
                <p className="font-medium">{item.label.replace('Conectar ', '')}</p>
                <p className="mt-1 min-h-10 text-xs text-muted-foreground">{item.description}</p>
                <Button className="mt-4 w-full" onClick={() => startConnect(channel)} disabled={pending !== null || !configured}>
                  {isConnecting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Link2 className="mr-2 size-4" />}
                  {item.label}
                </Button>
              </div>
            )
          })}
        </div>

        {!loading && relevant.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">Canales conectados</p>
            {relevant.map((connector) => {
              const channel = connectorChannel(connector.provider)
              const label = channel ? CHANNELS[channel].label.replace('Conectar ', '') : connector.provider
              const busy = pending?.endsWith(`:${connector.id}`)
              return (
                <div key={connector.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-3">
                  <div>
                    <p className="flex items-center gap-2 font-medium"><CheckCircle2 className={connector.status === 'paused' ? 'size-4 text-amber-500' : 'size-4 text-emerald-500'} />{connector.displayName || label}</p>
                    <p className="text-xs text-muted-foreground">{label} · {connector.status === 'paused' ? 'Pausado' : 'Conectado'}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void syncAvatars(connector)}>
                      {pending === `avatars:${connector.id}` ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <ImageDown className="mr-1 size-3.5" />}
                      Sincronizar fotos
                    </Button>
                    <Button variant="outline" size="sm" disabled={!!busy} onClick={() => manage(connector, connector.status === 'paused' ? 'resume' : 'pause')}>
                      {connector.status === 'paused' ? <Play className="mr-1 size-3.5" /> : <Pause className="mr-1 size-3.5" />}
                      {connector.status === 'paused' ? 'Reactivar' : 'Pausar'}
                    </Button>
                    <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={!!busy} onClick={() => manage(connector, 'delete')}>
                      <Trash2 className="mr-1 size-3.5" /> Eliminar
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
