import { describe, expect, it } from 'vitest'
import { parseZernioPublicComment } from './comment-context'

describe('Zernio public comment context', () => {
  it('keeps the publication and paid-ad context separate from Messenger', () => {
    expect(parseZernioPublicComment({
      event: 'comment.received',
      timestamp: '2026-10-14T20:00:00Z',
      account: { platform: 'facebook' },
      comment: {
        id: 'reply-2',
        platformPostId: 'page_123',
        platform: 'facebook',
        text: '¿Cuál es el precio?',
        createdAt: '2026-10-14T19:59:00Z',
        isReply: true,
        parentCommentId: 'root-1',
        author: { id: 'customer-1', name: 'Ana', picture: 'https://cdn.example/avatar.jpg' },
        ad: { id: 'ad-9', title: 'Consulta de especialidad' },
      },
      post: {
        platformPostId: 'page_123',
        content: 'Promoción de octubre',
        permalink: 'https://facebook.com/posts/123',
        imageUrl: 'https://cdn.example/post.jpg',
      },
    })).toMatchObject({
      id: 'reply-2',
      rootCommentId: 'root-1',
      platformPostId: 'page_123',
      text: '¿Cuál es el precio?',
      author: { id: 'customer-1', name: 'Ana', isOwnAccount: false },
      post: { title: 'Promoción de octubre', permalink: 'https://facebook.com/posts/123' },
      ad: { id: 'ad-9', title: 'Consulta de especialidad' },
    })
  })

  it('rejects unsupported or incomplete comment events', () => {
    expect(parseZernioPublicComment({ event: 'message.received' })).toBeNull()
    expect(parseZernioPublicComment({
      event: 'comment.received',
      account: { platform: 'linkedin' },
      comment: { id: '1', platformPostId: '2', author: { id: '3' } },
    })).toBeNull()
  })
})
