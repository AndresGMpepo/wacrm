import { describe, expect, it } from 'vitest'
import { audioExtensionForMimeType } from './media-analysis'

describe('audioExtensionForMimeType', () => {
  it.each([
    ['video/mp4', 'mp4'],
    ['audio/mp4; codecs=mp4a.40.2', 'mp4'],
    ['audio/m4a', 'm4a'],
    ['audio/mpeg', 'mp3'],
    ['audio/ogg', 'ogg'],
    ['audio/wav', 'wav'],
    ['audio/webm', 'webm'],
    ['application/octet-stream', 'webm'],
  ])('maps %s to .%s', (mimeType, extension) => {
    expect(audioExtensionForMimeType(mimeType)).toBe(extension)
  })
})
