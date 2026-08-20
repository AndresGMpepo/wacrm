import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { listZernioAccounts, type ZernioChannel } from '@/lib/zernio/server'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Falta la configuración del servidor.')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

function publicOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.APP_URL?.trim()
  if (configured && /^https:\/\//i.test(configured)) return configured.replace(/\/$/, '')
  return new URL(request.url).origin
}

function settingsRedirect(request: Request, tab: string, status: string, message?: string) {
  const url = new URL('/settings', publicOrigin(request))
  url.searchParams.set('tab', tab)
  url.searchParams.set('zernio', status)
  if (message) url.searchParams.set('zernio_message', message.slice(0, 180))
  return NextResponse.redirect(url, { status: 302 })
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const state = url.searchParams.get('state')
    const accountId = url.searchParams.get('accountId') ?? url.searchParams.get('account_id')
    const username = url.searchParams.get('username')
    const connected = url.searchParams.get('connected')
    if (!state) return settingsRedirect(request, 'social-messaging', 'error', 'La conexión no incluye un estado válido.')

    const db = admin()
    const { data: attempt, error } = await db.from('zernio_connection_attempts')
      .select('*').eq('state', state).maybeSingle()
    if (error) throw error
    if (!attempt || attempt.completed_at || new Date(attempt.expires_at).getTime() < Date.now()) {
      return settingsRedirect(request, 'social-messaging', 'error', 'El enlace de conexión venció. Inténtalo nuevamente.')
    }
    const tab = attempt.channel === 'whatsapp' ? 'whatsapp' : 'social-messaging'
  if (connected === 'error') {
      return settingsRedirect(request, tab, 'error', 'La cuenta no se terminó de seleccionar en el proveedor. Inténtalo nuevamente.')
    }

    const channel = attempt.channel as ZernioChannel
    if (connected && connected !== 'true' && connected !== channel) {
      return settingsRedirect(request, tab, 'error', 'El proveedor devolvió un canal distinto al solicitado. Inténtalo nuevamente.')
    }
    const accounts = await listZernioAccounts(attempt.zernio_profile_id, channel)
    const known = new Set(Array.isArray(attempt.known_account_ids) ? (attempt.known_account_ids as unknown[]).filter((id): id is string => typeof id === 'string') : [])
    const hint = username?.trim().toLowerCase()
    const selected =
      (accountId ? accounts.find((item) => item.id === accountId) : undefined) ??
      (hint ? accounts.find((item) => [item.username, item.displayName].some((value) => value?.toLowerCase() === hint)) : undefined) ??
      (() => {
        const added = accounts.filter((item) => !known.has(item.id))
        return added.length === 1 ? added[0] : accounts.length === 1 ? accounts[0] : undefined
      })()
    if (!selected) {
      return settingsRedirect(request, tab, 'error', 'No pudimos identificar de forma segura la cuenta conectada. Repite la conexión y selecciona una sola cuenta de este canal.')
    }

    const provider = `zernio_${channel}`
    const displayName = selected.displayName || selected.username || ({ whatsapp: 'WhatsApp', facebook: 'Facebook', instagram: 'Instagram' } as const)[channel]
    const now = new Date().toISOString()
    const { error: connectorError } = await db.from('omnichannel_connectors').upsert({
      account_id: attempt.account_id,
      provider,
      display_name: displayName.slice(0, 80),
      external_channel_id: selected.id.slice(0, 128),
      zernio_profile_id: attempt.zernio_profile_id,
      zernio_account_id: selected.id.slice(0, 256),
      zernio_metadata: { username: selected.username, display_name: selected.displayName, profile_url: selected.profileUrl, platform: selected.platform, connected_at: now },
      status: 'configured',
      last_error: null,
      created_by: attempt.user_id,
      updated_at: now,
    }, { onConflict: 'account_id,provider,external_channel_id' })
    if (connectorError) throw connectorError
    await db.from('zernio_connection_attempts').update({ completed_at: now }).eq('id', attempt.id)
    return settingsRedirect(request, tab, 'connected')
  } catch (error) {
    console.error('Zernio callback failed', error)
    return settingsRedirect(request, 'social-messaging', 'error', 'No fue posible guardar la conexión. Inténtalo nuevamente.')
  }
}
