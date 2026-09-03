import { describe, expect, it } from 'vitest'

import { matchNumberedOption } from './channel-send'

const options = [
  { id: 'btn_sales', title: 'Ventas' },
  { id: 'btn_support', title: 'Soporte técnico' },
  { id: 'btn_billing', title: 'Facturación' },
]

describe('matchNumberedOption', () => {
  it('matches the position the customer typed', () => {
    expect(matchNumberedOption('2', options)).toBe('btn_support')
    expect(matchNumberedOption(' 3 ', options)).toBe('btn_billing')
  })

  it('tolerates the number written with punctuation', () => {
    expect(matchNumberedOption('1.', options)).toBe('btn_sales')
    expect(matchNumberedOption('opción 2', options)).toBe('btn_support')
  })

  it('matches the option title ignoring case and accents', () => {
    expect(matchNumberedOption('ventas', options)).toBe('btn_sales')
    expect(matchNumberedOption('Soporte tecnico', options)).toBe('btn_support')
  })

  it('returns null for an out-of-range number', () => {
    expect(matchNumberedOption('0', options)).toBeNull()
    expect(matchNumberedOption('9', options)).toBeNull()
  })

  it('returns null for an unrelated answer', () => {
    expect(matchNumberedOption('quiero hablar con alguien', options)).toBeNull()
    expect(matchNumberedOption('', options)).toBeNull()
  })
})
