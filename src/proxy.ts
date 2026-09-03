import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() { return request.cookies.getAll() },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
      },
    },
  })

  const { data: { user } } = await supabase.auth.getUser()
  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
    return response
  }

  if (user && ['/login', '/signup', '/forgot-password'].includes(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone()
    const inviteToken = request.nextUrl.searchParams.get('invite')
    if (inviteToken && ['/login', '/signup'].includes(request.nextUrl.pathname)) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`
    } else {
      url.pathname = '/dashboard'
    }
    url.search = ''
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  const protectedPaths = ['/dashboard', '/inbox', '/contacts', '/pipelines', '/broadcasts', '/automations', '/settings', '/notifications', '/call-tasks', '/flows', '/agents', '/supervision']
  const isProtected = protectedPaths.some((path) => request.nextUrl.pathname.startsWith(path))
  if (!user && isProtected) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  if (user && isProtected) {
    const { data: accessRows, error: accessError } = await supabase.rpc('current_account_access_status')
    const access = Array.isArray(accessRows) ? accessRows[0] : null
    if (!accessError && access && !access.is_active) {
      const url = request.nextUrl.clone()
      url.pathname = '/account-suspended'
      url.search = access.status === 'trial' && access.ends_at ? `?until=${encodeURIComponent(access.ends_at)}` : ''
      return withRefreshedCookies(NextResponse.redirect(url))
    }
  }

  if (!user && request.nextUrl.pathname.startsWith('/api/whatsapp/') && !request.nextUrl.pathname.includes('/webhook')) {
    return withRefreshedCookies(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
  }
  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}