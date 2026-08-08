'use client'

import { useCallback, useEffect, useState } from 'react'
import { Building2, CirclePause, CirclePlay, LoaderCircle, Pencil, Send, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
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
  subscription: { plan_code: PlanCode; seat_limit: number; status: SubscriptionStatus; ends_at: string | null } | null
}

type SubscriptionStatus = 'active' | 'trial' | 'suspended' | 'cancelled'

const PLAN_LABELS: Record<PlanCode, string> = {
  ai: 'IA omnicanal',
  yeastar_voice: 'IA + voz Yeastar',
  whatsapp_voice: 'IA + Yeastar + voz WhatsApp',
}
const STATUS_LABELS: Record<SubscriptionStatus, string> = { active: 'Activa', trial: 'Demo', suspended: 'Pausada', cancelled: 'Cancelada' }
function dateInputValue(value: string | null) { return value ? value.slice(0, 10) : '' }
function isExpired(endsAt: string | null) { return !!endsAt && new Date(endsAt).getTime() <= Date.now() }
function displayStatus(subscription: PlatformAccount['subscription']) {
  if (!subscription) return 'Sin servicio'
  return isExpired(subscription.ends_at) ? 'Demo vencida' : STATUS_LABELS[subscription.status]
}

export default function PlatformPage() {
  const [accounts, setAccounts] = useState<PlatformAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [allowed, setAllowed] = useState(true)
  const [editing, setEditing] = useState<PlatformAccount | null>(null)
  const [editForm, setEditForm] = useState({ account_name: '', plan_code: 'ai' as PlanCode, seat_limit: '1', status: 'active' as SubscriptionStatus, ends_at: '' })
  const [actionId, setActionId] = useState<string | null>(null)
  const [form, setForm] = useState({ account_name: '', owner_name: '', owner_email: '', plan_code: 'ai' as PlanCode, seat_limit: '1', access_days: '0' })

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
        body: JSON.stringify({ ...form, seat_limit: Number(form.seat_limit), access_days: Number(form.access_days) }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? 'No se pudo crear la cuenta.')
      toast.success(json.message ?? 'Cuenta creada correctamente.')
      setForm({ account_name: '', owner_name: '', owner_email: '', plan_code: 'ai', seat_limit: '1', access_days: '0' })
      await load(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear la cuenta.')
    } finally {
      setSubmitting(false)
    }
  }

  const beginEdit = (account: PlatformAccount) => {
    if (!account.subscription) {
      toast.error('Esta cuenta no tiene una suscripción editable.')
      return
    }
    setEditing(account)
    setEditForm({ account_name: account.name, plan_code: account.subscription.plan_code, seat_limit: String(account.subscription.seat_limit), status: account.subscription.status, ends_at: dateInputValue(account.subscription.ends_at) })
  }

  const saveEdit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editing) return
    setActionId(editing.id)
    try {
      const response = await fetch(`/api/platform/accounts/${editing.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editForm, seat_limit: Number(editForm.seat_limit) }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? 'No se pudo actualizar la cuenta.')
      toast.success(json.message)
      setEditing(null)
      await load(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la cuenta.')
    } finally {
      setActionId(null)
    }
  }

  const setAccessStatus = async (account: PlatformAccount, status: SubscriptionStatus) => {
    if (!account.subscription) return
    if (status === 'active' && isExpired(account.subscription.ends_at)) {
      toast.error('Primero extiende o elimina la fecha de vencimiento en Editar para reactivar esta demo.')
      beginEdit(account)
      return
    }
    setActionId(account.id)
    try {
      const response = await fetch(`/api/platform/accounts/${account.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_name: account.name, plan_code: account.subscription.plan_code, seat_limit: account.subscription.seat_limit, status, ends_at: dateInputValue(account.subscription.ends_at) }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? 'No se pudo cambiar el acceso.')
      toast.success(status === 'suspended' ? 'Cuenta pausada: el cliente ya no puede acceder.' : 'Cuenta reactivada.')
      await load(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cambiar el acceso.')
    } finally {
      setActionId(null)
    }
  }

  const resendInvitation = async (account: PlatformAccount) => {
    setActionId(account.id)
    try {
      const response = await fetch(`/api/platform/accounts/${account.id}/invite`, { method: 'POST' })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? 'No se pudo reenviar la invitación.')
      toast.success(json.message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo reenviar la invitación.')
    } finally {
      setActionId(null)
    }
  }

  const removeAccount = async (account: PlatformAccount) => {
    if (!window.confirm(`Eliminar “${account.name}” y el acceso de ${account.owner?.email ?? 'su propietario'}? Esta acción borra sus datos de prueba y no se puede deshacer.`)) return
    setActionId(account.id)
    try {
      const response = await fetch(`/api/platform/accounts/${account.id}`, { method: 'DELETE' })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? 'No se pudo eliminar la cuenta.')
      toast.success(json.message)
      await load(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo eliminar la cuenta.')
    } finally {
      setActionId(null)
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
            <div className="space-y-2"><Label htmlFor="access_days">Días de acceso</Label><Input id="access_days" type="number" min={0} max={3650} value={form.access_days} onChange={(event) => setForm((current) => ({ ...current, access_days: event.target.value }))} required /><p className="text-xs text-muted-foreground">0 significa acceso sin fecha de vencimiento. 7 o 14 crea una demo con expiración automática.</p></div>
            <div className="space-y-2"><Label>Plan</Label><Select value={form.plan_code} onValueChange={(value) => setForm((current) => ({ ...current, plan_code: value as PlanCode }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(PLAN_LABELS) as PlanCode[]).map((plan) => <SelectItem key={plan} value={plan}>{PLAN_LABELS[plan]}</SelectItem>)}</SelectContent></Select></div>
            <div className="flex items-end"><Button type="submit" className="w-full md:w-auto" disabled={submitting}>{submitting ? <LoaderCircle className="animate-spin" /> : <UserPlus />}Crear e invitar</Button></div>
          </form>
        </CardContent>
      </Card>

      {editing ? <Card>
        <CardHeader><CardTitle>Editar cliente</CardTitle><CardDescription>El límite no puede ser menor que los usuarios ya activos.</CardDescription></CardHeader>
        <CardContent><form onSubmit={saveEdit} className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="edit-account-name">Nombre comercial</Label><Input id="edit-account-name" value={editForm.account_name} onChange={(event) => setEditForm((current) => ({ ...current, account_name: event.target.value }))} required maxLength={80} /></div>
          <div className="space-y-2"><Label htmlFor="edit-seat-limit">Usuarios contratados</Label><Input id="edit-seat-limit" type="number" min={1} max={1000} value={editForm.seat_limit} onChange={(event) => setEditForm((current) => ({ ...current, seat_limit: event.target.value }))} required /></div>
          <div className="space-y-2"><Label htmlFor="edit-ends-at">Acceso hasta</Label><Input id="edit-ends-at" type="date" value={editForm.ends_at} onChange={(event) => setEditForm((current) => ({ ...current, ends_at: event.target.value }))} /><p className="text-xs text-muted-foreground">Déjalo vacío para acceso sin vencimiento.</p></div>
          <div className="space-y-2"><Label>Plan</Label><Select value={editForm.plan_code} onValueChange={(value) => setEditForm((current) => ({ ...current, plan_code: value as PlanCode }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(PLAN_LABELS) as PlanCode[]).map((plan) => <SelectItem key={plan} value={plan}>{PLAN_LABELS[plan]}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Estado del servicio</Label><Select value={editForm.status} onValueChange={(value) => setEditForm((current) => ({ ...current, status: value as SubscriptionStatus }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(STATUS_LABELS) as SubscriptionStatus[]).map((status) => <SelectItem key={status} value={status}>{STATUS_LABELS[status]}</SelectItem>)}</SelectContent></Select></div>
          <div className="flex items-end gap-2"><Button type="submit" disabled={actionId === editing.id}>{actionId === editing.id ? <LoaderCircle className="animate-spin" /> : <Pencil />}Guardar cambios</Button><Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={actionId === editing.id}>Cancelar</Button></div>
        </form></CardContent>
      </Card> : null}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="size-5" />Clientes aprovisionados</CardTitle><CardDescription>Usuarios usados frente a los asientos contratados.</CardDescription></CardHeader>
        <CardContent>
          {loading ? <div className="flex justify-center py-8"><LoaderCircle className="animate-spin text-muted-foreground" /></div> : accounts.length === 0 ? <p className="py-4 text-sm text-muted-foreground">Aún no hay clientes aprovisionados.</p> : <div className="divide-y rounded-lg border">{accounts.map((account) => <div key={account.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-center lg:gap-4"><div className="min-w-0"><p className="truncate font-medium">{account.name}</p><p className="truncate text-sm text-muted-foreground">{account.owner?.full_name ?? 'Propietario pendiente'} · {account.owner?.email ?? 'sin correo'}</p>{account.subscription?.ends_at ? <p className="mt-1 text-xs text-amber-500">Acceso hasta {new Date(account.subscription.ends_at).toLocaleDateString('es-MX')}</p> : null}</div><div><p className="text-sm text-muted-foreground">{account.subscription ? PLAN_LABELS[account.subscription.plan_code] : 'Sin plan'}</p><p className={isExpired(account.subscription?.ends_at ?? null) || account.subscription?.status === 'suspended' || account.subscription?.status === 'cancelled' ? 'text-sm font-medium text-destructive' : 'text-sm font-medium text-emerald-500'}>{displayStatus(account.subscription)}</p></div><p className="text-sm font-medium">{account.members}/{account.subscription?.seat_limit ?? 0} usuarios</p><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => beginEdit(account)} disabled={actionId === account.id}><Pencil />Editar</Button>{account.subscription?.status === 'active' || account.subscription?.status === 'trial' ? <Button type="button" size="sm" variant="outline" onClick={() => setAccessStatus(account, 'suspended')} disabled={actionId === account.id}><CirclePause />Pausar</Button> : <Button type="button" size="sm" variant="outline" onClick={() => setAccessStatus(account, 'active')} disabled={actionId === account.id}><CirclePlay />Reactivar</Button>}<Button type="button" size="sm" variant="outline" onClick={() => resendInvitation(account)} disabled={actionId === account.id}>{actionId === account.id ? <LoaderCircle className="animate-spin" /> : <Send />}Reenviar</Button><Button type="button" size="sm" variant="destructive" onClick={() => removeAccount(account)} disabled={actionId === account.id}><Trash2 />Borrar</Button></div></div>)}</div>}
        </CardContent>
      </Card>
    </div>
  )
}
