import type { MessagePostContext } from '@/types'

type Json = Record<string, unknown>

function record(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
}

function text(...values: unknown[]) {
  for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim()
  return ''
}

function httpsUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

// A shared Facebook post usually arrives as a link to the post itself
// (facebook.com/story.php?...), while Instagram shares arrive as a signed
// CDN media URL. Only the former is safe to open as "Ver publicación".
function isPostPermalink(url: string) {
  const host = new URL(url).hostname.toLowerCase()
  return /(^|\.)(facebook|instagram)\.com$/.test(host) || host === 'fb.me' || host === 'instagr.am'
}

const SHARE_KINDS: Record<string, MessagePostContext['kind']> = {
  ig_post: 'shared_post',
  post: 'shared_post',
  share: 'shared_post',
  ig_reel: 'shared_reel',
  reel: 'shared_reel',
  ig_story: 'shared_story',
  story: 'shared_story',
  story_mention: 'story_mention',
}

/**
 * Builds the "what is the customer writing from" context Meta's own inbox
 * shows above a message, from the fields Zernio documents on
 * `message.received` (https://docs.zernio.com/webhooks/inbox#messagereceived
 * and the InboxWebhookMessage metadata schema in zernio.com/openapi.json):
 * `metadata.storyReply`, `metadata.isStoryMention`, `metadata.referral`,
 * `metadata.noRenderableContent` and `attachments[].originalType`.
 * Click-to-Messenger ads are handled separately (`ad_referral`).
 */
export function extractZernioPostContext(message: Json, metadata: Json): MessagePostContext | null {
  const storyReply = record(metadata.storyReply)
  const storyId = text(storyReply.storyId, storyReply.story_id)
  if (storyId || storyReply.storyUrl) {
    return { kind: 'story_reply', story_id: storyId || undefined, url: httpsUrl(storyReply.storyUrl ?? storyReply.story_url) }
  }

  const attachments = Array.isArray(message.attachments) ? message.attachments.map(record) : []
  for (let index = 0; index < attachments.length; index++) {
    const attachment = attachments[index]
    const originalType = text(attachment.originalType, attachment.original_type).toLowerCase()
    const type = text(attachment.type).toLowerCase()
    const kind = metadata.isStoryMention === true
      ? 'story_mention'
      : SHARE_KINDS[originalType] ?? (type === 'share' ? 'shared_post' : undefined)
    if (!kind) continue
    const url = httpsUrl(attachment.url)
    const permalink = url && isPostPermalink(url) ? url : undefined
    return {
      kind,
      url: permalink ? undefined : url,
      permalink,
      attachment_index: index,
    }
  }

  if (metadata.isStoryMention === true) return { kind: 'story_mention' }

  const referral = record(metadata.referral)
  const source = text(referral.source)
  if (source && source.toUpperCase() !== 'ADS') {
    const ref = text(referral.ref)
    return { kind: 'link_referral', ref: ref || undefined, source, permalink: httpsUrl(referral.referer_uri ?? referral.refererUri) }
  }

  if (metadata.noRenderableContent === true) return { kind: 'unavailable' }

  return null
}
