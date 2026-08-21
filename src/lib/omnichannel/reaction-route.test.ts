import { describe, expect, it } from 'vitest'
import { getReactionEndpoint } from '@/lib/omnichannel/reaction-route'

describe('getReactionEndpoint', () => {
  it('routes omnichannel conversations through the unified omnichannel reaction API', () => {
    expect(getReactionEndpoint('facebook')).toBe('/api/omnichannel/react')
    expect(getReactionEndpoint('instagram')).toBe('/api/omnichannel/react')
    expect(getReactionEndpoint('zernio_whatsapp')).toBe('/api/omnichannel/react')
    expect(getReactionEndpoint('zernio_facebook')).toBe('/api/omnichannel/react')
    expect(getReactionEndpoint('zernio_instagram')).toBe('/api/omnichannel/react')
  })

  it('keeps WhatsApp on the native Meta reaction route', () => {
    expect(getReactionEndpoint('whatsapp')).toBe('/api/whatsapp/react')
    expect(getReactionEndpoint(null)).toBe('/api/whatsapp/react')
  })
})
