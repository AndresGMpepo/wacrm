import Link from 'next/link'
import { CirclePause } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function AccountSuspendedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card text-center">
        <CardHeader className="items-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-amber-500/10"><CirclePause className="size-6 text-amber-500" /></div>
          <CardTitle>Acceso no disponible</CardTitle>
          <CardDescription>La cuenta está pausada, cancelada o su periodo de demostración terminó.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Contacta al administrador comercial para reactivar el servicio. Tus datos permanecen resguardados mientras se resuelve la cuenta.
          <p className="mt-5"><Link href="/login" className="text-primary hover:underline">Volver al inicio de sesión</Link></p>
        </CardContent>
      </Card>
    </main>
  )
}
