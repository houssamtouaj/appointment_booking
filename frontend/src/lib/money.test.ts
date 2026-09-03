import { beforeEach, describe, expect, it } from 'vitest'

import { resetLanguageStoreForTests, setLanguage } from '@/i18n/language'
import {
  currencyDigits,
  formatMoney,
  isAmountInput,
  toAmountInput,
  toMinorUnits,
} from '@/lib/money'

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

describe('toMinorUnits', () => {
  it('round-trips the price the wave gate names', () => {
    // 12.10 → 1210 → "€12.10". The middle number is what goes on the wire, and
    // the demo verifies it in the network tab.
    const cents = toMinorUnits('12.10', 'EUR')
    expect(cents).toBe(1210)
    expect(flatten(formatMoney(cents, 'EUR', 'en-IE'))).toBe('€12.10')
  })

  it('does not lose a cent at .005 — the case Math.round(n * 100) gets wrong', () => {
    // `1.005 * 100` is 100.49999999999999, so the float route rounds *down* and
    // charges a cent less than the price that was typed. 572 of the 10 000
    // two-decimal half-cent prices land the wrong side of that, `0.145` and
    // `1.255` among them. Proven here rather than asserted, so the comment
    // cannot rot on the day V8 changes its mind.
    expect(Math.round(1.005 * 100)).toBe(100)
    expect(toMinorUnits('1.005', 'EUR')).toBe(101)

    expect(Math.round(0.145 * 100)).toBe(14)
    expect(toMinorUnits('0.145', 'EUR')).toBe(15)
  })

  it('is exact at 12.10, where the double is not', () => {
    // The wave plan cites `12.10 * 100` as the motivating case and is half
    // right: the *stored* double for 12.10 is 12.099999999999999645, and the
    // multiplication happens to round back to exactly 1210. The class of bug is
    // real — see the previous test — but this is not one of its instances, and
    // a test asserting it were would fail for the right reason.
    expect((12.1).toFixed(18)).toBe('12.099999999999999645')
    expect(12.1 * 100).toBe(1210)
    expect(toMinorUnits('12.10', 'EUR')).toBe(1210)
  })

  it('rounds .995 up, and up to the next unit', () => {
    expect(toMinorUnits('12.995', 'EUR')).toBe(1300)
  })

  it('rounds half away from zero only at the half — .0049 stays down', () => {
    // The digit-by-digit reason the remainder is compared whole: looking only at
    // the first dropped digit cannot separate .0049 from .005.
    expect(toMinorUnits('12.0049', 'EUR')).toBe(1200)
    expect(toMinorUnits('12.0051', 'EUR')).toBe(1201)
  })

  it('scales by the currency, not by 100', () => {
    // A JPY price of 4500 is 4500 minor units. Scaling by 100 would send
    // 450000 and sell a ¥4,500 service for ¥450,000.
    expect(toMinorUnits('4500', 'JPY')).toBe(4500)
    expect(toMinorUnits('1.234', 'BHD')).toBe(1234)
  })

  it('reads a pasted comma as a decimal separator', () => {
    expect(toMinorUnits('12,10', 'EUR')).toBe(1210)
  })

  it('pads a bare unit count and a leading dot', () => {
    expect(toMinorUnits('12', 'EUR')).toBe(1200)
    expect(toMinorUnits('.5', 'EUR')).toBe(50)
    expect(toMinorUnits('0', 'EUR')).toBe(0)
  })

  it('refuses the strings Number() would quietly accept', () => {
    // `Number('')` is 0, which is a free service rather than an empty field —
    // the one failure this validation exists to prevent.
    for (const text of ['', ' ', '.', '1e3', '0x10', 'Infinity', '-5', '12.10.5']) {
      expect(isAmountInput(text)).toBe(false)
      expect(() => toMinorUnits(text, 'EUR')).toThrow()
    }
  })

  it('accepts what the price input can produce', () => {
    for (const text of ['0', '12', '12.1', '12.10', '12,10', '.5', ' 7 ']) {
      expect(isAmountInput(text)).toBe(true)
    }
  })
})

describe('toAmountInput', () => {
  it('fills the edit form with a bare decimal, not a formatted price', () => {
    // `<input type="number">` accepts nothing else, and `toMinorUnits` reads it
    // straight back.
    expect(toAmountInput(1210, 'EUR')).toBe('12.10')
    expect(toAmountInput(4500, 'JPY')).toBe('4500')
    expect(toAmountInput(1234, 'BHD')).toBe('1.234')
  })

  it('round-trips every price in the demo catalogue', () => {
    for (const cents of [0, 5, 1210, 3500, 4499, 7200]) {
      expect(toMinorUnits(toAmountInput(cents, 'EUR'), 'EUR')).toBe(cents)
    }
  })
})

describe('currencyDigits', () => {
  it('reports the currency’s own scale, which is what the input’s step is', () => {
    expect(currencyDigits('EUR')).toBe(2)
    expect(currencyDigits('JPY')).toBe(0)
    expect(currencyDigits('BHD')).toBe(3)
  })
})

describe('the default locale', () => {
  beforeEach(() => {
    localStorage.clear()
    resetLanguageStoreForTests()
  })

  it('formats a price in the chosen language', () => {
    setLanguage('fr')
    // French uses a comma and a narrow no-break space, and puts the symbol last.
    // The digit count is still the currency's, not the locale's.
    expect(formatMoney(4500, 'EUR')).toMatch(/45,00/)
  })

  it('keeps the currency minor units regardless of language', () => {
    setLanguage('fr')
    expect(formatMoney(4500, 'JPY')).toMatch(/4\s?500/)
    expect(formatMoney(4500, 'JPY')).not.toMatch(/,00/)
  })
})
