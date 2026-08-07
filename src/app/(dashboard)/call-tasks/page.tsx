'use client'

import { PhoneCall } from 'lucide-react'
import { CallFollowUpQueue } from '@/components/telephony/call-follow-up-queue'

export default function CallTasksPage() {
  return <div className="mx-auto w-full max-w-5xl space-y-6 p-5 sm:p-7"><div><h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><PhoneCall className="size-6 text-primary" />Llamadas pendientes</h1><p className="mt-1 text-sm text-muted-foreground">Seguimientos asignados por falta de respuesta. Atiéndelos desde el softphone y conserva el historial en el chat.</p></div><section className="rounded-xl border border-border bg-card p-4 sm:p-5"><CallFollowUpQueue /></section></div>
}
