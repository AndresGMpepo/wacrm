type Json = Record<string, unknown>

function record(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
}

function text(...values: unknown[]) {
  for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim()
  return ''
}

function httpsUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export type ZernioPublicComment = {
  id: string
  rootCommentId: string
  parentCommentId: string | null
  platformPostId: string
  platform: 'facebook' | 'instagram'
  text: string
  createdAt: string | null
  author: {
    id: string
    name: string
    picture: string | null
    isOwnAccount: boolean
  }
  post: {
    title: string | null
    permalink: string | null
    imageUrl: string | null
  }
  ad: {
    id: string | null
    title: string | null
  } | null
}

/**
 * Normalizes Zernio's documented `comment.received` payload. Keep this
 * separate from DM normalization: comments use a post and root-comment
 * identity, not an inbox conversation id.
 */
export function parseZernioPublicComment(event: Json): ZernioPublicComment | null {
  if (event.event !== 'comment.received') return null
  const comment = record(event.comment)
  const post = record(event.post)
  const author = record(comment.author)
  const ad = record(comment.ad)
  const platform = text(comment.platform, record(event.account).platform)
  if (platform !== 'facebook' && platform !== 'instagram') return null
  const id = text(comment.id)
  const authorId = text(author.id)
  const platformPostId = text(comment.platformPostId, post.platformPostId)
  if (!id || !authorId || !platformPostId) return null
  const parentCommentId = text(comment.parentCommentId) || null
  return {
    id,
    rootCommentId: comment.isReply === true && parentCommentId ? parentCommentId : id,
    parentCommentId,
    platformPostId,
    platform,
    text: text(comment.text) || '[Comentario sin texto]',
    createdAt: text(comment.createdAt, event.timestamp) || null,
    author: {
      id: authorId,
      name: text(author.name, author.username),
      picture: httpsUrl(author.picture),
      isOwnAccount: author.isOwnAccount === true,
    },
    post: {
      title: text(post.content) || null,
      permalink: httpsUrl(post.permalink),
      imageUrl: httpsUrl(post.imageUrl),
    },
    ad: Object.keys(ad).length ? {
      id: text(ad.id) || null,
      title: text(ad.title) || null,
    } : null,
  }
}
