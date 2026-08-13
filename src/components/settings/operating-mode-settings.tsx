'use client'

import { useEffect, useState } from 'react'
import { BarChart3, BriefcaseBusiness, Headphones, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'

import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { SettingsPanelHead } from './settings-panel-head'

type OperatingMode = 'commercial' | 'support' | 'hybrid'

const OPTIONS: { value: OperatingMode; title: string; description: string; icon: typeof BriefcaseBusiness }[] = [
  { value: 'commercial', title: 'Comercial', description: 'Prioriza pipeline, campañas, oportunidades y conversión.', icon: BriefcaseBusiness },
  { value: 'support', title: 'Soporte', description: 'Prioriza SLA, carga de agentes, resolución y calidad de atención.', icon: Headphones },
  { value: 'hybrid', title: 'Híbrido', description: 'Combina crecimiento comercial y operación de soporte.', icon: BarChart3 },
]

export function OperatingModeSettings() {
  const { canEditSettings, profileLoading } = useAuth()
  const [saved, setSaved] = useState<OperatingMode>('hybrid')
  const [selected, setSelected] = useState<OperatingMode>('hybrid')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    void fetch('/api/account/operating-mode', { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() as Promise<{ operating_mode?: OperatingMode }> : null)
      .then((payload) => {
        if (!active || !payload) return
        const mode = payload.operating_mode ?? 'hybrid'
        setSaved(mode)
        setSelected(mode)
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
        body: JSON.stringify({ operating_mode: selected }),
      })
      const payload = await response.json().catch(() => null) as { operating_mode?: OperatingMode; error?: string } | null
      if (!response.ok || !payload?.operating_mode) throw new Error(payload?.error ?? 'No se pudo guardar.')
      setSaved(payload.operating_mode)
      toast.success('Perfil operativo actualizado. Los reportes ya usan este enfoque.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el perfil operativo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title="Objetivo operativo" description="Define qué información debe priorizar NexoOmni para dirección. No cambia tus datos ni las funciones contratadas." />
      <Card>
        <CardHeader>
          <CardTitle>Enfoque de la empresa</CardTitle>
          <CardDescription>El tablero de Reportes ajustará el orden y la lectura ejecutiva a este objetivo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
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
          {!canEditSettings ? <p className="text-xs text-muted-foreground">Solo propietarios y administradores pueden cambiar este objetivo.</p> : null}
          {canEditSettings ? <Button onClick={save} disabled={saving || loading || selected === saved}>
            {saving ? <><Loader2 className="size-4 animate-spin" /> Guardando…</> : <><Save className="size-4" /> Guardar objetivo</>}
          </Button> : null}
        </CardContent>
      </Card>
    </section>
  )
}
