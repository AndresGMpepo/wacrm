'use client'

import { Brain, PhoneCall } from 'lucide-react'
import { CallFollowUpQueue } from '@/components/telephony/call-follow-up-queue'
import { NexoMemoryFollowUpQueue } from '@/components/contacts/nexo-memory-follow-up-queue'

export default function CallTasksPage() {
  return <div className="mx-auto w-full max-w-5xl space-y-6 p-5 sm:p-7"><div><h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><PhoneCall className="size-6 text-primary" />Seguimientos por llamada</h1><p className="mt-1 text-sm text-muted-foreground">Contactos que requieren seguimiento por falta de respuesta. Revisa el último análisis disponible, atiéndelos desde el softphone y conserva el resultado en el chat.</p></div><section className="rounded-xl border border-border bg-card p-4 sm:p-5"><CallFollowUpQueue /></section><div><h2 className="flex items-center gap-2 text-lg font-semibold text-foreground"><Brain className="size-5 text-primary" />Seguimientos de Nexo Memory</h2><p className="mt-1 text-sm text-muted-foreground">Compromisos vencidos, clientes en riesgo alto y prospectos sin seguimiento detectados automáticamente por Nexo Memory.</p></div><section className="rounded-xl border border-border bg-card p-4 sm:p-5"><NexoMemoryFollowUpQueue /></section></div>
}
