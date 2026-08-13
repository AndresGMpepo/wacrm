'use client'

import Link from 'next/link'
import { ArrowRight, BellRing, ChartNoAxesCombined, Inbox, PhoneCall, ShieldAlert } from 'lucide-react'


const shortcuts = [
  { href: '/inbox', title: 'Bandeja prioritaria', description: 'Responde las conversaciones y mensajes nuevos.', icon: Inbox, tone: 'text-primary' },
  { href: '/call-tasks', title: 'Llamadas pendientes', description: 'Atiende los seguimientos que requieren llamada.', icon: PhoneCall, tone: 'text-red-400' },
  { href: '/supervision', title: 'Supervisión', description: 'Revisa carga, alertas y llamadas del equipo.', icon: ShieldAlert, tone: 'text-amber-400' },
  { href: '/reports', title: 'Reportes ejecutivos', description: 'Consulta tendencias, campañas y desempeño.', icon: ChartNoAxesCombined, tone: 'text-emerald-400', adminOnly: true },
]

export function OperationalShortcuts({ canViewReports }: { canViewReports: boolean }) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><BellRing className="size-4 text-primary" />Prioridades de hoy</h2>
          <p className="mt-1 text-xs text-muted-foreground">Acciones operativas; las tendencias y análisis permanecen en Reportes.</p>
        </div>
      </header>
      <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
        {shortcuts.filter((item) => !item.adminOnly || canViewReports).map((item) => {
          const Icon = item.icon
          return <Link key={item.href} href={item.href} className="group bg-card p-4 transition-colors hover:bg-muted/60">
            <div className="flex items-start justify-between gap-3"><span className={`rounded-lg bg-muted p-2 ${item.tone}`}><Icon className="size-4" /></span></div>
            <p className="mt-3 flex items-center gap-1 text-sm font-medium text-foreground">{item.title}<ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" /></p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p>
          </Link>
        })}
      </div>
    </section>
  )
}
