'use client'

import { useEffect, useState } from 'react'
import { KeyRound, LoaderCircle } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const MIN_PASSWORD_LENGTH = 8

/**
 * Landing page for Supabase invite links. Supabase consumes the hash fragment
 * in the browser and establishes a short-lived authenticated session; only
 * then do we expose the password form. This prevents a raw invite link from
 * being mistaken for an ordinary login screen.
 */
export default function SetPasswordPage() {
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    let active = true

    const resolveSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!active) return
      if (session) setReady(true)
      else setError('El enlace no es válido o ya venció. Solicita una nueva invitación al administrador de la plataforma.')
    }

    void resolveSession()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active && session) {
        setError(null)
        setReady(true)
      }
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`)
      return
    }
    if (password !== confirmation) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setSaving(true)
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setError(updateError.message)
      setSaving(false)
      return
    }
    window.location.href = '/dashboard'
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-primary/10"><KeyRound className="size-6 text-primary" /></div>
          <CardTitle className="text-xl text-foreground">Crea tu contraseña</CardTitle>
          <CardDescription>Define una contraseña para activar tu acceso a NexoOmni.</CardDescription>
        </CardHeader>
        <CardContent>
          {!ready && !error ? <div className="flex justify-center py-6"><LoaderCircle className="animate-spin text-muted-foreground" /></div> : null}
          {error ? <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
          {ready ? <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="new-password">Contraseña</Label><Input id="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required /></div>
            <div className="space-y-2"><Label htmlFor="confirm-password">Confirmar contraseña</Label><Input id="confirm-password" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" required /></div>
            <Button type="submit" className="w-full" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" /> : <KeyRound />}Activar acceso</Button>
          </form> : null}
        </CardContent>
      </Card>
    </div>
  )
}
