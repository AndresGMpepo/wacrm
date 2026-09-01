import { describe, expect, it } from 'vitest'
import {
  extractMetaAttachment,
  extractMetaReaction,
  extractZernioMedia,
  extractZernioReaction,
  normalizeMetaText,
  safeMetaContactName,
  safeZernioContactName,
} from '@/lib/omnichannel/webhook-normalizer'

describe('extractMetaAttachment', () => {
  it('reads the media payload and caption without exposing technical ids', () => {
    const media = extractMetaAttachment({
      attachments: [
        {
          type: 'image',
          payload: {
            url: 'https://cdn.example.com/image.png',
            mime_type: 'image/png',
            caption: 'Hola',
          },
        },
      ],
    })

    expect(media).toStrictEqual({
      kind: 'image',
      url: 'https://cdn.example.com/image.png',
      mimeType: 'image/png',
      caption: 'Hola',
      fileName: undefined,
    })
  })
})

describe('extractMetaReaction', () => {
  it('picks up a customer reaction from the inbound payload', () => {
    const reaction = extractMetaReaction({
      reaction: { message_id: 'meta-mid-1', emoji: '😍' },
    })

    expect(reaction).toStrictEqual({
      targetMessageId: 'meta-mid-1',
      emoji: '😍',
    })
  })
})

describe('safeMetaContactName', () => {
  it('keeps the fallback human-readable and never uses the connector id as visible identity', () => {
    const name = safeMetaContactName('facebook', 'meta:facebook:abc123')
    expect(name).toContain('Cliente Facebook')
    expect(name).not.toContain('meta:facebook')
  })
})

describe('extractZernioMedia', () => {
  it('reads media payloads and captions from the Zernio envelope', () => {
    const media = extractZernioMedia({
      media: {
        type: 'image',
        url: 'https://cdn.example.com/zernio.png',
        mime_type: 'image/png',
        caption: 'Hola desde Zernio',
      },
    })

    expect(media).toStrictEqual({
      kind: 'image',
      url: 'https://cdn.example.com/zernio.png',
      mimeType: 'image/png',
      caption: 'Hola desde Zernio',
      fileName: undefined,
    })
  })

  it('reads array-based Zernio attachments so image captions are not lost', () => {
    const media = extractZernioMedia({
      attachments: [
        {
          type: 'image',
          url: 'https://cdn.example.com/attachment.png',
          mime_type: 'image/png',
          caption: 'Mi foto',
        },
      ],
    })

    expect(media).toStrictEqual({
      kind: 'image',
      url: 'https://cdn.example.com/attachment.png',
      mimeType: 'image/png',
      caption: 'Mi foto',
      fileName: undefined,
    })
  })

  it('accepts camelCase Zernio media fields from connected WhatsApp payloads', () => {
    const media = extractZernioMedia({
      message: {
        attachment: {
          attachmentType: 'audio',
          mediaUrl: 'https://zernio.com/api/v1/whatsapp/media/media-123',
          contentType: 'audio/ogg',
          fileName: 'voice-note.ogg',
        },
      },
    })

    expect(media).toStrictEqual({
      kind: 'audio',
      url: 'https://zernio.com/api/v1/whatsapp/media/media-123',
      mimeType: 'audio/ogg',
      caption: undefined,
      fileName: 'voice-note.ogg',
    })
  })
})

describe('extractZernioReaction', () => {
  it('reads nested event and incoming reaction payloads without exposing internal ids', () => {
    const reaction = extractZernioReaction({
      incoming: {
        reaction: {
          message_id: 'zernio-mid-42',
          emoji: '👍',
        },
      },
    })

    expect(reaction).toStrictEqual({
      targetMessageId: 'zernio-mid-42',
      emoji: '👍',
    })
  })
})

describe('safeZernioContactName', () => {
  it('keeps the public fallback name and hides connector internals', () => {
    const name = safeZernioContactName('whatsapp', 'zernio:whatsapp:abc123')
    expect(name).toContain('Cliente WhatsApp')
    expect(name).not.toContain('zernio:whatsapp')
  })
})

describe('normalizeMetaText', () => {
  it('keeps text and the media caption but drops empty placeholders', () => {
    expect(normalizeMetaText('Hola', undefined)).toBe('Hola')
    expect(normalizeMetaText('', 'Llega una foto')).toBe('Llega una foto')
    expect(normalizeMetaText('   ', '')).toBe('[Mensaje sin texto]')
  })
})
