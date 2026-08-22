import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export const ZERNIO_CHANNELS = ['whatsapp', 'facebook', 'instagram'] as const
export type ZernioChannel = (typeof ZERNIO_CHANNELS)[number]

const DEFAULT_API_URL = 'https://zernio.com/api/v1'

function apiUrl() {
  return (process.env.ZERNIO_API_BASE_URL?.trim() || DEFAULT_API_URL).replace(/\/$/, '')
}

function apiKey() {
  const key = process.env.ZERNIO_API_KEY?.trim()
  if (!key) throw new Error('La conexión guiada no está disponible todavía. El administrador debe configurar ZERNIO_API_KEY en el servidor.')
  return key
}

export async function zernioFetch(path: string, init?: RequestInit) {
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData
  const response = await fetch(`${apiUrl()}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      Accept: 'application/json',
      ...(!isFormData && init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const body = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok) {
    const error = body?.error && typeof body.error === 'object' ? body.error as Record<string, unknown> : {}
    const detail = typeof body?.message === 'string' ? body.message
      : typeof error.message === 'string' ? error.message
        : typeof body?.error === 'string' ? body.error
          : typeof error.title === 'string' ? error.title
            : `HTTP ${response.status}`
    const code = typeof error.code === 'string' || typeof error.code === 'number' ? ` (${error.code})` : ''
    throw new Error(`Zernio no pudo completar la solicitud${code}: ${detail}`)
  }
  return body ?? {}
}

function profileIdFrom(value: Record<string, unknown>) {
  const profile = value.profile as Record<string, unknown> | undefined
  const data = value.data as Record<string, unknown> | undefined
  const nestedProfile = data?.profile as Record<string, unknown> | undefined
  const id = profile?._id ?? profile?.id ?? nestedProfile?._id ?? nestedProfile?.id ?? data?._id ?? data?.id ?? value._id ?? value.id
  return typeof id === 'string' && id.trim() ? id : null
}

export async function ensureZernioProfile(
  db: SupabaseClient,
  accountId: string,
  accountName: string,
  userId: string,
) {
  const { data, error } = await db
    .from('zernio_profiles')
    .select('profile_id')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  if (data?.profile_id) return data.profile_id as string

  const created = await zernioFetch('/profiles', {
    method: 'POST',
    body: JSON.stringify({ name: accountName.slice(0, 120) || 'Cuenta NexoOmni' }),
  })
  const profileId = profileIdFrom(created)
  if (!profileId) throw new Error('Zernio no devolvió un identificador de perfil para esta cuenta.')

  const { error: saveError } = await db.from('zernio_profiles').upsert({
    account_id: accountId,
    profile_id: profileId,
    created_by: userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'account_id' })
  if (saveError) throw saveError
  return profileId
}

export async function getZernioConnectUrl(channel: ZernioChannel, profileId: string, redirectUrl: string) {
  const query = new URLSearchParams({ profileId, redirect_url: redirectUrl })
  const response = await zernioFetch(`/connect/${channel}?${query.toString()}`)
  const data = response.data as Record<string, unknown> | undefined
  const authUrl = response.authUrl ?? response.url ?? data?.authUrl ?? data?.url
  if (typeof authUrl !== 'string' || !authUrl.startsWith('https://')) {
    throw new Error('Zernio no devolvió la URL segura de conexión.')
  }
  return authUrl
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export type ZernioConnectedAccount = {
  id: string
  platform: ZernioChannel
  username: string | null
  displayName: string | null
  profileUrl: string | null
}

/**
 * The hosted connection flow may only return a user hint. We retrieve the
 * connected account from the server API after the redirect instead of trusting
 * a browser-supplied account id.
 */
export async function listZernioAccounts(profileId: string, channel: ZernioChannel) {
  // Zernio requires both pagination parameters together. Supplying only
  // `limit` causes its accounts endpoint to reject the request before OAuth.
  const query = new URLSearchParams({ profileId, platform: channel, status: 'connected', page: '1', limit: '100' })
  const payload = await zernioFetch(`/accounts?${query.toString()}`)
  const data = record(payload.data)
  const source = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.accounts)
      ? payload.accounts
      : Array.isArray(data.accounts)
        ? data.accounts
        : []

  return source.flatMap((value): ZernioConnectedAccount[] => {
    const item = record(value)
    const id = asText(item._id ?? item.id ?? item.accountId ?? item.account_id)
    if (!id) return []
    const platform = asText(item.platform)?.toLowerCase()
    if (platform && platform !== channel) return []
    return [{
      id,
      platform: channel,
      username: asText(item.username ?? item.handle),
      displayName: asText(item.displayName ?? item.name),
      profileUrl: asText(item.profileUrl ?? item.profile_url),
    }]
  })
}

export function isZernioChannel(value: string): value is ZernioChannel {
  return (ZERNIO_CHANNELS as readonly string[]).includes(value)
}

export function extractZernioPlatformMessageId(messageId: string | null | undefined) {
  if (!messageId) return null
  const raw = messageId.trim()
  if (!raw) return null
  const match = raw.match(/^zernio:[^:]+:(.+)$/)
  return match ? match[1] : raw
}

export function zernioAttachmentTypeFrom(kind: string | null | undefined) {
  const normalized = (kind || '').toLowerCase()
  if (normalized === 'document' || normalized === 'file') return 'file'
  if (normalized === 'image') return 'image'
  if (normalized === 'video') return 'video'
  if (normalized === 'audio') return 'audio'
  return 'file'
}

export async function resolveZernioPlatformMessageId(
  conversationId: string,
  zernioAccountId: string,
  zernioMessageId: string,
) {
  const payload = await zernioFetch(`/inbox/conversations/${encodeURIComponent(conversationId)}/messages?${new URLSearchParams({ accountId: zernioAccountId, limit: '100', sortOrder: 'desc' })}`)
  const matches: Record<string, unknown>[] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!value || typeof value !== 'object') return
    const item = value as Record<string, unknown>
    if (item.id === zernioMessageId || item.messageId === zernioMessageId) matches.push(item)
    Object.values(item).forEach((child) => {
      if (child && typeof child === 'object') visit(child)
    })
  }
  visit(payload)
  const match = matches[0]
  const platformId = match?.platformMessageId ?? match?.platform_message_id ?? match?.nativeMessageId ?? match?.externalMessageId
  return typeof platformId === 'string' && platformId.trim() ? platformId : null
}

function secureUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/** Read the customer avatar maintained by Zernio's unified inbox. */
export async function getZernioParticipantPicture(conversationId: string, zernioAccountId: string) {
  const query = new URLSearchParams({ accountId: zernioAccountId })
  const payload = await zernioFetch(`/inbox/conversations/${encodeURIComponent(conversationId)}?${query.toString()}`, {
    signal: AbortSignal.timeout(3_000),
  })
  const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : payload
  return secureUrl(data.participantPicture ?? data.participant_picture)
}

export async function sendZernioText(conversationId: string, zernioAccountId: string, text: string) {
  const payload = await zernioFetch(`/inbox/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ accountId: zernioAccountId, message: text }),
  })
  const message = payload.message as Record<string, unknown> | undefined
  const data = payload.data as Record<string, unknown> | undefined
  const nestedMessage = data?.message as Record<string, unknown> | undefined
  const id = message?.id ?? message?._id ?? nestedMessage?.id ?? nestedMessage?._id ?? data?.messageId ?? data?.id ?? payload.messageId ?? payload.id
  return typeof id === 'string' && id.trim() ? id : null
}

export async function uploadZernioMedia(file: Blob, contentType?: string) {
  const form = new FormData()
  form.append('file', file, (file as File).name || 'upload')
  if (contentType) form.append('contentType', contentType)

  const payload = await zernioFetch('/media/upload-direct', {
    method: 'POST',
    body: form,
  })

  const recordPayload = (payload ?? {}) as Record<string, unknown>
  const data = (recordPayload.data ?? {}) as Record<string, unknown>
  const url = typeof recordPayload.url === 'string'
    ? recordPayload.url
    : typeof data.url === 'string'
      ? data.url
      : null
  if (!url) throw new Error('Zernio no devolvió una URL pública para el archivo adjunto.')
  return url
}

export async function sendZernioMedia(
  conversationId: string,
  zernioAccountId: string,
  message: string | undefined,
  attachmentUrl: string,
  attachmentType: 'image' | 'video' | 'audio' | 'document' | 'file',
  attachmentName?: string,
) {
  const payload = await zernioFetch(`/inbox/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({
      accountId: zernioAccountId,
      ...(message ? { message } : {}),
      attachmentUrl,
      attachmentType,
      ...(attachmentName ? { attachmentName } : {}),
    }),
  })
  const data = payload.data as Record<string, unknown> | undefined
  const messagePayload = payload.message as Record<string, unknown> | undefined
  const nestedMessage = data?.message as Record<string, unknown> | undefined
  const id = messagePayload?.id ?? messagePayload?._id ?? nestedMessage?.id ?? nestedMessage?._id ?? data?.messageId ?? data?.id ?? payload.messageId ?? payload.id
  return typeof id === 'string' && id.trim() ? id : null
}

export async function addZernioReaction(conversationId: string, messageId: string, zernioAccountId: string, emoji: string) {
  const payload = await zernioFetch(`/inbox/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ accountId: zernioAccountId, emoji }),
  })
  return Boolean(payload.success ?? payload.data ?? payload)
}

export async function removeZernioReaction(conversationId: string, messageId: string, zernioAccountId: string) {
  await zernioFetch(`/inbox/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/reactions`, {
    method: 'DELETE',
    body: JSON.stringify({ accountId: zernioAccountId }),
  })
  return true
}

/** Verify only when the installation explicitly configures a webhook secret. */
export function verifyZernioSignature(raw: string, signature: string | null) {
  const secret = process.env.ZERNIO_WEBHOOK_SECRET?.trim()
  if (!secret) return true
  if (!signature) return false
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex')
  const received = signature.replace(/^sha256=/i, '').trim().split(',').at(-1)?.trim() ?? ''
  if (received.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))
}
