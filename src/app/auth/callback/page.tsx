'use client'

import { useEffect } from 'react'

/**
 * Compatibility bridge for recovery links issued before the password flow
 * moved to /set-password. Supabase places the temporary session in the URL
 * fragment, so it must be preserved verbatim during this client-side redirect.
 */
export default function AuthCallbackPage() {
  useEffect(() => {
    window.location.replace(`/set-password${window.location.hash}`)
  }, [])

  return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Preparando el restablecimiento de contraseña…</main>
}
