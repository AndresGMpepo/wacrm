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

function flattenZernioRecords(value: unknown): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = []
  const visit = (node: unknown) => {
    if (node == null) return
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (typeof node !== 'object') return
    const record = node as Record<string, unknown>
    records.push(record)
    for (const key of ['data', 'payload', 'media', 'attachment', 'attachments', 'file', 'files', 'document', 'audio', 'image', 'video', 'message', 'reaction', 'reactions', 'incoming', 'event']) {
      if (key in record) visit(record[key])
    }
  }
  visit(value)
  return records
}

export function extractZernioMedia(value: Record<string, unknown>): MetaAttachment | undefined {
  const candidates = flattenZernioRecords(value)
  let textOnly: MetaAttachment | undefined
  for (const recordValue of candidates) {
    const mimeType = asText(recordValue.mime_type ?? recordValue.mimeType ?? recordValue.mime ?? recordValue.content_type ?? recordValue.contentType)
    const url = safeUrl(recordValue.url ?? recordValue.href ?? recordValue.link ?? recordValue.file_url ?? recordValue.fileUrl ?? recordValue.media_url ?? recordValue.mediaUrl ?? recordValue.download_url ?? recordValue.downloadUrl ?? recordValue.attachment_url ?? recordValue.attachmentUrl)
    const caption = asText(recordValue.caption ?? recordValue.text ?? recordValue.body ?? recordValue.message ?? recordValue.description)
    const fileName = asText(recordValue.filename ?? recordValue.name ?? recordValue.file_name ?? recordValue.fileName)
    const type = asText(recordValue.type ?? recordValue.kind ?? recordValue.media_type ?? recordValue.mediaType ?? recordValue.attachment_type ?? recordValue.attachmentType ?? recordValue.mimeType)
    const normalizedType = (type ?? 'document').toLowerCase()
    const knownType = normalizedType.includes('image') ? 'image'
      : normalizedType.includes('video') ? 'video'
      : normalizedType.includes('audio') || normalizedType.includes('voice') ? 'audio'
      : normalizedType.includes('document') || normalizedType.includes('file') || normalizedType.includes('pdf') ? 'document'
      : 'document'
    if (url || mimeType || fileName) {
      return {
        kind: knownType,
        url,
        mimeType,
        caption,
        fileName,
      }
    }
    if (caption && !textOnly) {
      textOnly = { kind: 'text', caption }
    }
  }

  if (textOnly) return textOnly

  const directUrl = safeUrl(value.url ?? value.href ?? value.link ?? value.media_url ?? value.mediaUrl ?? value.file_url ?? value.fileUrl ?? value.download_url ?? value.downloadUrl ?? value.attachment_url ?? value.attachmentUrl)
  if (directUrl || asText(value.caption) || asText(value.mime_type) || asText(value.filename)) {
    return {
      kind: 'document',
      url: directUrl,
      mimeType: asText(value.mime_type) ?? asText(value.mimeType) ?? asText(value.content_type) ?? asText(value.contentType),
      caption: asText(value.caption),
      fileName: asText(value.filename) ?? asText(value.name) ?? asText(value.file_name) ?? asText(value.fileName),
    }
  }

  return undefined
}

export function extractZernioReaction(value: Record<string, unknown>): MetaReaction | undefined {
  const candidates = flattenZernioRecords(value)
  for (const recordValue of candidates) {
    const emoji = asText(recordValue.emoji ?? recordValue.icon ?? recordValue.symbol)
    const target = asText(recordValue.platformMessageId ?? recordValue.platform_message_id ?? recordValue.messageId ?? recordValue.message_id ?? recordValue.targetMessageId ?? recordValue.target_message_id ?? recordValue.id)
    if (emoji || target) {
      return { targetMessageId: target, emoji }
    }
  }

  const directEmoji = asText(value.emoji ?? value.icon)
  const directTarget = asText(value.platformMessageId ?? value.platform_message_id ?? value.messageId ?? value.message_id ?? value.targetMessageId ?? value.target_message_id)
  if (directEmoji || directTarget) {
    return { targetMessageId: directTarget, emoji: directEmoji }
  }

  return undefined
}
