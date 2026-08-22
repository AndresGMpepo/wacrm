'use client'

import { useEffect, useState } from 'react'
import { BarChart3, BriefcaseBusiness, CalendarDays, Headphones, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'

import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { SettingsPanelHead } from './settings-panel-head'

type OperatingMode = 'commercial' | 'support' | 'services' | 'hybrid'
type AccountModule = 'pipelines' | 'appointments'

const OPTIONS: { value: OperatingMode; title: string; description: string; icon: typeof BriefcaseBusiness }[] = [
  { value: 'commercial', title: 'Comercial', description: 'Prioriza pipeline, campañas, oportunidades y conversión.', icon: BriefcaseBusiness },
  { value: 'support', title: 'Soporte', description: 'Prioriza SLA, carga de agentes, resolución y calidad de atención.', icon: Headphones },
  { value: 'services', title: 'Servicios y citas', description: 'Prioriza atención, agenda, confirmaciones y asistencia.', icon: CalendarDays },
  { value: 'hybrid', title: 'Híbrido', description: 'Combina crecimiento comercial y operación de soporte.', icon: BarChart3 },
]

export function OperatingModeSettings() {
  const { canEditSettings, profileLoading } = useAuth()
  const [saved, setSaved] = useState<OperatingMode>('hybrid')
  const [selected, setSelected] = useState<OperatingMode>('hybrid')
  const [savedModules, setSavedModules] = useState<AccountModule[]>(['pipelines'])
  const [selectedModules, setSelectedModules] = useState<AccountModule[]>(['pipelines'])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    void fetch('/api/account/operating-mode', { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() as Promise<{ operating_mode?: OperatingMode; enabled_modules?: AccountModule[] }> : null)
      .then((payload) => {
        if (!active || !payload) return
        const mode = payload.operating_mode ?? 'hybrid'
        setSaved(mode)
        setSelected(mode)
        const accountModules = payload.enabled_modules ?? ['pipelines']
        setSavedModules(accountModules)
        setSelectedModules(accountModules)
      })
      .catch(() => toast.error('No se pudo cargar el perfil operativo.'))
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function save() {
    setSaving(true)
    try {
      const response = await fetch('/api/account/operating-mode', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operating_mode: selected, enabled_modules: selectedModules }),
      })
      const payload = await response.json().catch(() => null) as { operating_mode?: OperatingMode; enabled_modules?: AccountModule[]; error?: string } | null
      if (!response.ok || !payload?.operating_mode) throw new Error(payload?.error ?? 'No se pudo guardar.')
      setSaved(payload.operating_mode)
      setSavedModules(payload.enabled_modules ?? selectedModules)
      toast.success('Objetivo y módulos actualizados.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el perfil operativo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title="Objetivo operativo" description="Define el enfoque de dirección y los módulos visibles de la cuenta." />
      <Card>
        <CardHeader>
          <CardTitle>Enfoque de la empresa</CardTitle>
          <CardDescription>El objetivo guía los reportes; los módulos controlan las herramientas disponibles para el equipo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {OPTIONS.map((option) => {
              const Icon = option.icon
              const active = selected === option.value
              return (
                <button key={option.value} type="button" disabled={!canEditSettings || loading || profileLoading} onClick={() => setSelected(option.value)}
                  className={cn('rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60', active ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-border hover:bg-muted/60')}>
                  <Icon className={cn('mb-3 size-5', active ? 'text-primary' : 'text-muted-foreground')} />
                  <p className="font-semibold text-foreground">{option.title}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{option.description}</p>
                </button>
              )
            })}
          </div>
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">Módulos de la cuenta</p>
            <label className="flex items-start gap-3 rounded-lg border border-border p-3">
              <input type="checkbox" checked={selectedModules.includes('pipelines')} disabled={!canEditSettings || loading || profileLoading} onChange={(event) => setSelectedModules((current) => event.target.checked ? [...current, 'pipelines'] : current.filter((module) => module !== 'pipelines'))} className="mt-0.5 size-4" />
              <span><span className="block text-sm font-medium">Pipelines</span><span className="text-xs text-muted-foreground">Oportunidades, etapas y conversión comercial.</span></span>
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-border p-3">
              <input type="checkbox" checked={selectedModules.includes('appointments')} disabled={!canEditSettings || loading || profileLoading} onChange={(event) => setSelectedModules((current) => event.target.checked ? [...current, 'appointments'] : current.filter((module) => module !== 'appointments'))} className="mt-0.5 size-4" />
              <span><span className="block text-sm font-medium">Agenda de citas</span><span className="text-xs text-muted-foreground">Prepara la cuenta para agenda, confirmaciones y futuras integraciones de calendario.</span></span>
            </label>
          </div>
          {!canEditSettings ? <p className="text-xs text-muted-foreground">Solo propietarios y administradores pueden cambiar este objetivo.</p> : null}
          {canEditSettings ? <Button onClick={save} disabled={saving || loading || (selected === saved && selectedModules.join(',') === savedModules.join(','))}>
            {saving ? <><Loader2 className="size-4 animate-spin" /> Guardando…</> : <><Save className="size-4" /> Guardar objetivo</>}
          </Button> : null}
        </CardContent>
      </Card>
    </section>
  )
}
