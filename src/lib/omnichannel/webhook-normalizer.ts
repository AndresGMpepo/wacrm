export type MetaAttachmentKind = 'image' | 'video' | 'audio' | 'document'

export type MetaAttachment = {
  kind: MetaAttachmentKind | 'text'
  url?: string
  mimeType?: string
  caption?: string
  fileName?: string
}

export type MetaReaction = {
  targetMessageId?: string
  emoji?: string
}

function asText(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  return undefined
}

function safeUrl(value: unknown): string | undefined {
  const text = asText(value)
  if (!text) return undefined
  try {
    const url = new URL(text)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export function normalizeMetaText(text: unknown, fallback?: unknown): string {
  const value = asText(text) ?? asText(fallback)
  return value ?? '[Mensaje sin texto]'
}

export function safeMetaContactName(provider: 'facebook' | 'instagram', externalUserId: string): string {
  const label = provider === 'facebook' ? 'Cliente Facebook' : 'Cliente Instagram'
  const suffix = externalUserId.trim() ? externalUserId.slice(-6) : 'anon'
  return `${label} ${suffix}`
}

export function extractMetaAttachment(value: Record<string, unknown>): MetaAttachment | undefined {
  const attachments = Array.isArray(value.attachments) ? value.attachments : []
  const first = attachments[0]
  if (!first || typeof first !== 'object') return undefined
  const attachment = first as Record<string, unknown>
  const type = asText(attachment.type) || 'text'
  const payload = attachment.payload && typeof attachment.payload === 'object' ? attachment.payload as Record<string, unknown> : {}
  const url = safeUrl(payload.url)
  const mimeType = asText(payload.mime_type)
  const caption = asText(payload.caption)
  const fileName = asText(payload.filename) ?? asText(payload.name)

  if (type === 'image' || type === 'video' || type === 'audio' || type === 'document') {
    return {
      kind: type,
      url,
      mimeType,
      caption,
      fileName,
    }
  }

  if (url || mimeType || caption) {
    return {
      kind: 'text',
      url,
      mimeType,
      caption,
      fileName,
    }
  }

  return undefined
}

export function extractMetaReaction(value: Record<string, unknown>): MetaReaction | undefined {
  const reaction = value.reaction && typeof value.reaction === 'object' ? value.reaction as Record<string, unknown> : undefined
  if (!reaction) return undefined
  const emoji = asText(reaction.emoji)
  const target = asText(reaction.message_id)
  if (!emoji && !target) return undefined
  return {
    targetMessageId: target,
    emoji,
  }
}

export function safeZernioContactName(provider: 'whatsapp' | 'facebook' | 'instagram', externalUserId: string): string {
  const label = provider === 'whatsapp' ? 'Cliente WhatsApp' : provider === 'facebook' ? 'Cliente Facebook' : 'Cliente Instagram'
  const suffix = externalUserId.trim() ? externalUserId.slice(-6) : 'anon'
  return `${label} ${suffix}`
}

export function extractZernioMedia(value: Record<string, unknown>): MetaAttachment | undefined {
  const candidates = [value.media, value.attachment, value.attachments, value.file, value.files, value.document, value.audio, value.image, value.video]
  for (const candidate of candidates) {
    const recordValue = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      ? candidate as Record<string, unknown>
      : undefined
    if (recordValue) {
      const mimeType = asText(recordValue.mime_type ?? recordValue.mimeType)
      const url = safeUrl(recordValue.url ?? recordValue.href ?? recordValue.link)
      const caption = asText(recordValue.caption ?? recordValue.text ?? recordValue.body)
      const fileName = asText(recordValue.filename ?? recordValue.name)
      const type = asText(recordValue.type ?? recordValue.kind ?? recordValue.mediaType) ?? 'document'
      const normalizedType = type.toLowerCase()
      const knownType = normalizedType.includes('image') ? 'image'
        : normalizedType.includes('video') ? 'video'
        : normalizedType.includes('audio') || normalizedType.includes('voice') ? 'audio'
        : normalizedType.includes('document') || normalizedType.includes('file') || normalizedType.includes('pdf') ? 'document'
        : 'document'
      if (url || mimeType || caption || fileName) {
        return {
          kind: knownType,
          url,
          mimeType,
          caption,
          fileName,
        }
      }
    }
  }

  const directUrl = safeUrl(value.url ?? value.href ?? value.link)
  if (directUrl || asText(value.caption) || asText(value.mime_type) || asText(value.filename)) {
    return {
      kind: 'document',
      url: directUrl,
      mimeType: asText(value.mime_type) ?? asText(value.mimeType),
      caption: asText(value.caption),
      fileName: asText(value.filename) ?? asText(value.name),
    }
  }

  return undefined
}

export function extractZernioReaction(value: Record<string, unknown>): MetaReaction | undefined {
  const nestedEvent = value.event && typeof value.event === 'object' ? value.event as Record<string, unknown> : {}
  const nestedIncoming = value.incoming && typeof value.incoming === 'object' ? value.incoming as Record<string, unknown> : {}
  const candidates = [value.reaction, value.message_reaction, value.reactions, nestedEvent.reaction, nestedIncoming.reaction]
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue
    const reaction = candidate as Record<string, unknown>
    const emoji = asText(reaction.emoji ?? reaction.icon ?? reaction.symbol)
    const target = asText(reaction.messageId ?? reaction.message_id ?? reaction.targetMessageId ?? reaction.target_message_id)
    if (emoji || target) {
      return { targetMessageId: target, emoji }
    }
  }

  const directEmoji = asText(value.emoji ?? value.icon)
  const directTarget = asText(value.messageId ?? value.message_id ?? value.targetMessageId ?? value.target_message_id)
  if (directEmoji || directTarget) {
    return { targetMessageId: directTarget, emoji: directEmoji }
  }

  return undefined
}
