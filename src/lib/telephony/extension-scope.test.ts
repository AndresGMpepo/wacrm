import { describe, expect, it } from 'vitest'
import { isExtensionAllowed, parseExtensionRanges, validateExtensionFilterSpec } from './extension-scope'

describe('extension scope parsing', () => {
  it('treats an empty spec as "no restriction"', () => {
    expect(parseExtensionRanges(null)).toBeNull()
    expect(parseExtensionRanges(undefined)).toBeNull()
    expect(parseExtensionRanges('  ')).toBeNull()
    expect(isExtensionAllowed('7000', null)).toBe(true)
    expect(isExtensionAllowed(null, null)).toBe(true)
  })

  it('parses ranges and single extensions separated by commas', () => {
    expect(parseExtensionRanges('1000-1120,1200,1205-1210')).toEqual([[1000, 1120], [1200, 1200], [1205, 1210]])
  })

  it('normalizes a reversed range', () => {
    expect(parseExtensionRanges('1120-1000')).toEqual([[1000, 1120]])
  })

  it('ignores malformed tokens rather than throwing', () => {
    expect(parseExtensionRanges('abc, ,1000-1010')).toEqual([[1000, 1010]])
    expect(parseExtensionRanges('abc')).toBeNull()
  })

  it('allows only extensions within the configured ranges', () => {
    const ranges = parseExtensionRanges('1000-1120,1200')
    expect(isExtensionAllowed('1000', ranges)).toBe(true)
    expect(isExtensionAllowed('1120', ranges)).toBe(true)
    expect(isExtensionAllowed('1200', ranges)).toBe(true)
    expect(isExtensionAllowed('1121', ranges)).toBe(false)
    expect(isExtensionAllowed('999', ranges)).toBe(false)
  })

  it('rejects a call with no determinable extension once a restriction is configured', () => {
    const ranges = parseExtensionRanges('1000-1120')
    expect(isExtensionAllowed(null, ranges)).toBe(false)
    expect(isExtensionAllowed(undefined, ranges)).toBe(false)
    expect(isExtensionAllowed('not-a-number', ranges)).toBe(false)
  })

  it('validates a filter spec before saving it', () => {
    expect(validateExtensionFilterSpec('')).toBeNull()
    expect(validateExtensionFilterSpec('1000-1120,1200')).toBeNull()
    expect(validateExtensionFilterSpec('1000-1120, ,1200')).toBeNull()
    expect(validateExtensionFilterSpec('1000-abc')).toMatch(/no es válido/)
    expect(validateExtensionFilterSpec(',')).toMatch(/al menos un rango/)
  })
})
