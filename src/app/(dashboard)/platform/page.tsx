'use client'

import { useCallback, useEffect, useState } from 'react'
import { Building2, LoaderCircle, ShieldCheck, UserPlus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type PlanCode = 'ai' | 'yeastar_voice' | 'whatsapp_voice'
type PlatformAccount = {
  id: string
  name: string
  created_at: string
  owner: { full_name: string | null; email: string | null } | null
  members: number
  subscription: { plan_code: PlanCode; seat_limit: number; status: string } | null
}

const PLAN_LABELS: Record<PlanCode, string> = {
  ai: 'IA omnicanal',
  yeastar_voice: 'IA + voz Yeastar',
  whatsapp_voice: 'IA + Yeastar + voz WhatsApp',
}

export default function PlatformPage() {
  const [accounts, setAccounts] = useState<PlatformAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [allowed, setAllowed] = useState(true)
  const [form, setForm] = useState({ account_name: '', owner_name: '', owner_email: '', plan_code: 'ai' as PlanCode, seat_limit: '1' })

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const response = await fetch('/api/platform/accounts', { cache: 'no-store' })
      const json = await response.json()
      if (!response.ok) {
        if (response.status === 403) setAllowed(false)
        throw new Error(json.error ?? 'No se pudo cargar la plataforma.')
      }
      setAllowed(true)
      setAccounts(json.accounts ?? [])
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : 'No se pudo cargar la plataforma.')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      const response = await fetch('/api/platform/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, seat_limit: Number(form.seat_limit) }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? 'No se pudo crear la cuenta.')
      toast.success(json.message ?? 'Cuenta creada correctamente.')
      setForm({ account_name: '', owner_name: '', owner_email: '', plan_code: 'ai', seat_limit: '1' })
      await load(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear la cuenta.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!loading && !allowed) {
    return <div className="mx-auto max-w-xl py-12 text-center"><ShieldCheck className="mx-auto size-9 text-muted-foreground" /><h1 className="mt-4 text-2xl font-bold">Acceso de plataforma restringido</h1><p className="mt-2 text-sm text-muted-foreground">Tu usuario no está autorizado para administrar clientes comerciales.</p></div>
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <div className="flex items-center gap-2"><ShieldCheck className="size-6 text-primary" /><h1 className="text-2xl font-bold tracking-tight">Operación de plataforma</h1></div>
        <p className="mt-1 text-sm text-muted-foreground">Aprovisiona clientes y define su plan antes de que entren a WACRM.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><UserPlus className="size-5" />Nuevo cliente</CardTitle><CardDescription>Se enviará al propietario un enlace de acceso. Las personas clientes no pueden crear nuevos usuarios desde la aplicación.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="account_name">Nombre comercial</Label><Input id="account_name" value={form.account_name} onChange={(event) => setForm((current) => ({ ...current, account_name: event.target.value }))} required maxLength={80} /></div>
            <div className="space-y-2"><Label htmlFor="owner_name">Nombre del propietario</Label><Input id="owner_name" value={form.owner_name} onChange={(event) => setForm((current) => ({ ...current, owner_name: event.target.value }))} required maxLength={120} /></div>
            <div className="space-y-2"><Label htmlFor="owner_email">Correo del propietario</Label><Input id="owner_email" type="email" value={form.owner_email} onChange={(event) => setForm((current) => ({ ...current, owner_email: event.target.value }))} required /></div>
            <div className="space-y-2"><Label htmlFor="seat_limit">Usuarios contratados</Label><Input id="seat_limit" type="number" min={1} max={1000} value={form.seat_limit} onChange={(event) => setForm((current) => ({ ...current, seat_limit: event.target.value }))} required /></div>
            <div className="space-y-2"><Label>Plan</Label><Select value={form.plan_code} onValueChange={(value) => setForm((current) => ({ ...current, plan_code: value as PlanCode }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(PLAN_LABELS) as PlanCode[]).map((plan) => <SelectItem key={plan} value={plan}>{PLAN_LABELS[plan]}</SelectItem>)}</SelectContent></Select></div>
            <div className="flex items-end"><Button className="w-full md:w-auto" disabled={submitting}>{submitting ? <LoaderCircle className="animate-spin" /> : <UserPlus />}Crear e invitar</Button></div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="size-5" />Clientes aprovisionados</CardTitle><CardDescription>Usuarios usados frente a los asientos contratados.</CardDescription></CardHeader>
        <CardContent>
          {loading ? <div className="flex justify-center py-8"><LoaderCircle className="animate-spin text-muted-foreground" /></div> : accounts.length === 0 ? <p className="py-4 text-sm text-muted-foreground">Aún no hay clientes aprovisionados.</p> : <div className="divide-y rounded-lg border">{accounts.map((account) => <div key={account.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4"><div className="min-w-0"><p className="truncate font-medium">{account.name}</p><p className="truncate text-sm text-muted-foreground">{account.owner?.full_name ?? 'Propietario pendiente'} · {account.owner?.email ?? 'sin correo'}</p></div><p className="text-sm text-muted-foreground">{account.subscription ? PLAN_LABELS[account.subscription.plan_code] : 'Sin plan'}</p><p className="text-sm font-medium">{account.members}/{account.subscription?.seat_limit ?? 0} usuarios</p></div>)}</div>}
        </CardContent>
      </Card>
    </div>
  )
}
