'use client'

import { ShieldAlert } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { TelephonyLiveMonitor } from '@/components/supervision/telephony-live-monitor'

export default function SupervisionPage() {
  const { accountRole } = useAuth()
  const allowed = accountRole === 'owner' || accountRole === 'admin'
  return <div className="space-y-6"><div><h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><ShieldAlert className="size-6 text-primary" />Supervisión operativa</h1><p className="mt-1 text-sm text-muted-foreground">Visibilidad de llamadas activas y herramientas de acompañamiento para supervisores.</p></div>{allowed ? <TelephonyLiveMonitor /> : <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">Solo propietarios y administradores pueden acceder a la supervisión.</div>}</div>
}
