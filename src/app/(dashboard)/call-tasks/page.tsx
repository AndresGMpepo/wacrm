'use client'

import { Brain } from 'lucide-react'
import { NexoFollowUpsQueue } from '@/components/contacts/nexo-follow-ups-queue'

export default function CallTasksPage() {
  return <div className="mx-auto w-full max-w-5xl space-y-6 p-5 sm:p-7"><div><h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><Brain className="size-6 text-primary" />Seguimientos Nexo</h1><p className="mt-1 text-sm text-muted-foreground">Alertas de seguimiento generadas por Nexo Memory: llamadas sin respuesta, compromisos vencidos, clientes en riesgo alto y prospectos sin actividad. Atiéndelos desde el softphone o el chat y conserva el resultado.</p></div><section className="rounded-xl border border-border bg-card p-4 sm:p-5"><NexoFollowUpsQueue /></section></div>
}
