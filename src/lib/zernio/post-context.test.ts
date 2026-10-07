import { describe, expect, it } from 'vitest'
import { extractZernioPostContext } from './post-context'

describe('extractZernioPostContext', () => {
  it('reads an Instagram story reply from metadata.storyReply', () => {
    expect(extractZernioPostContext({ attachments: [] }, {
      storyReply: { storyId: '1789', storyUrl: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1' },
    })).toEqual({ kind: 'story_reply', story_id: '1789', url: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1' })
  })

  it('classifies a shared Instagram post by originalType and keeps its CDN media as preview', () => {
    expect(extractZernioPostContext({
      attachments: [{ type: 'share', originalType: 'ig_post', url: 'https://scontent.cdninstagram.com/v/abc.jpg' }],
    }, {})).toEqual({ kind: 'shared_post', url: 'https://scontent.cdninstagram.com/v/abc.jpg', permalink: undefined, attachment_index: 0 })
  })

  it('treats a facebook.com link as the post permalink', () => {
    const context = extractZernioPostContext({
      attachments: [{ type: 'share', originalType: 'post', url: 'https://m.facebook.com/story.php?story_fbid=1&id=2' }],
    }, {})
    expect(context).toMatchObject({ kind: 'shared_post', permalink: 'https://m.facebook.com/story.php?story_fbid=1&id=2' })
    expect(context?.url).toBeUndefined()
  })

  it('detects reels and story mentions', () => {
    expect(extractZernioPostContext({ attachments: [{ type: 'video', originalType: 'ig_reel', url: 'https://x.fbcdn.net/r.mp4' }] }, {})?.kind).toBe('shared_reel')
    expect(extractZernioPostContext({ attachments: [{ type: 'share', originalType: 'story_mention', url: 'https://x.fbcdn.net/s.jpg' }] }, { isStoryMention: true })?.kind).toBe('story_mention')
  })

  it('records non-ad link referrals but leaves ad clicks to ad_referral', () => {
    expect(extractZernioPostContext({ attachments: [] }, { referral: { ref: 'promo', source: 'SHORTLINK', type: 'OPEN_THREAD' } }))
      .toMatchObject({ kind: 'link_referral', ref: 'promo', source: 'SHORTLINK' })
    expect(extractZernioPostContext({ attachments: [] }, { referral: { source: 'ADS', ad_id: '1' } })).toBeNull()
  })

  it('flags content Meta withholds and ignores ordinary messages', () => {
    expect(extractZernioPostContext({ attachments: [] }, { noRenderableContent: true })).toEqual({ kind: 'unavailable' })
    expect(extractZernioPostContext({ text: 'hola', attachments: [{ type: 'image', url: 'https://x.fbcdn.net/i.jpg' }] }, {})).toBeNull()
  })
})
