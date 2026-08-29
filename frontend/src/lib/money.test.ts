import { describe, expect, it } from 'vitest'

import { formatMoney } from '@/lib/money'

/**
 * Named after the failures they prevent rather than after the function they
 * call. Two of these are the reason the module does not simply divide by 100.
 *
 * `Intl` puts a narrow no-break space between a French amount and its symbol,
 * so every assertion that looks at punctuation normalises whitespace first —
 * asserting on the exact byte would be a test that fails on an ICU upgrade
 * without anything being wrong.
 */
const flatten = (value: string) => value.replace(/\s/g, ' ')

describe('formatMoney', () => {
  it('renders the demo catalogue from priceCents and the business currency', () => {
    // Couleur, 7200 cents, from the live demo payload.
    expect(flatten(formatMoney(7200, 'EUR', 'en-IE'))).toBe('€72.00')
  })

  it('does not round a price away — 4499 is not exactly representable as a float', () => {
    // The whole reason the scaling is string surgery: 4499 / 100 is
    // 44.990000000000002, and a customer reading "€44.99" agreed to that price.
    expect(flatten(formatMoney(4499, 'EUR', 'en-IE'))).toBe('€44.99')
  })

  it('pads a price smaller than one unit rather than dropping the leading zero', () => {
    expect(flatten(formatMoney(5, 'EUR', 'en-IE'))).toBe('€0.05')
  })

  it('divides by the currency, not by 100 — JPY has no minor unit', () => {
    // The bug this file exists to prevent: /100 renders ¥45 for a ¥4,500
    // service, and the confirmation email the backend sends says ¥4,500.
    expect(flatten(formatMoney(4500, 'JPY', 'en-US'))).toBe('¥4,500')
  })

  it('handles a three-decimal currency', () => {
    // BHD has 3 minor digits. A hard-coded two-place formatter reports ten
    // times the price.
    expect(flatten(formatMoney(1234, 'BHD', 'en-US'))).toBe('BHD 1.234')
  })

  it('punctuates for the reader while keeping the business currency', () => {
    // Same amount, same currency, French separators — which is the only thing
    // the locale is allowed to change.
    expect(flatten(formatMoney(12000, 'EUR', 'fr-FR'))).toBe('120,00 €')
  })

  it('renders zero as a price rather than as an empty string', () => {
    expect(flatten(formatMoney(0, 'EUR', 'en-IE'))).toBe('€0.00')
  })
})
