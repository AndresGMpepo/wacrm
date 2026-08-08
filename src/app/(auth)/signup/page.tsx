import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

/**
 * WACRM is sold by contracted seat. New accounts and users are created
 * only by the platform operation, so this route deliberately contains no
 * Supabase signUp call and cannot create an unbilled tenant from the UI.
 */
export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl text-foreground">Acceso administrado</CardTitle>
          <CardDescription className="text-muted-foreground">
            Los accesos se crean por el equipo de plataforma según los usuarios contratados. Solicita tu acceso al administrador de tu cuenta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login">
            <Button className="w-full">Iniciar sesión</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
