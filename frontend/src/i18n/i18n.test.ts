import { beforeEach, describe, expect, it } from 'vitest'

import { translate, localeFor } from '@/i18n'
import { en } from '@/i18n/en'
import { fr } from '@/i18n/fr'
import { resetLanguageStoreForTests, setLanguage } from '@/i18n/language'

beforeEach(() => {
  localStorage.clear()
  resetLanguageStoreForTests()
})

describe('translate', () => {
  it('reads the current language', () => {
    expect(translate('common.cancel')).toBe(en.common.cancel)
    setLanguage('fr')
    expect(translate('common.cancel')).toBe(fr.common.cancel)
  })

  it('substitutes every placeholder', () => {
    expect(translate('booking.heldUntil', { time: '11:00' })).toContain('11:00')
  })

  it('leaves an unsubstituted placeholder visible rather than blank', () => {
    // A missing variable must be loud. An empty string reads as finished copy
    // and ships; "{time}" on screen gets reported the first time anyone sees it.
    expect(translate('booking.heldUntil')).toContain('{time}')
  })

  it('picks the English plural form by count', () => {
    expect(translate('booking.slotCount', { count: 1 })).toBe('1 time')
    expect(translate('booking.slotCount', { count: 0 })).toBe('0 times')
    expect(translate('booking.slotCount', { count: 5 })).toBe('5 times')
  })

  it('picks the French plural form by count, where zero is singular', () => {
    setLanguage('fr')
    // The rule English does not have: fr treats 0 and 1 alike. Hard-coding
    // `count === 1` in a component is exactly the bug Intl.PluralRules removes.
    expect(translate('booking.slotCount', { count: 0 })).toBe('0 horaire')
    expect(translate('booking.slotCount', { count: 1 })).toBe('1 horaire')
    expect(translate('booking.slotCount', { count: 5 })).toBe('5 horaires')
  })
})

describe('localeFor', () => {
  it('keeps the browser region when it agrees with the language', () => {
    // Playwright pins en-GB and asserts on formatted dates; collapsing that to a
    // bare "en" would resolve as en-US and rewrite every date in the e2e spec.
    // Asserted against the browser's own tag rather than a literal, because that
    // is the property — jsdom reports en-US here and Playwright reports en-GB,
    // and both are correct answers to "keep the region the reader already has".
    expect(localeFor('en')).toBe(navigator.languages[0])
    expect(navigator.languages[0]).toMatch(/^en-/)
  })

  it('falls back to a canonical region when the browser disagrees', () => {
    expect(localeFor('fr')).toBe('fr-FR')
  })
})

/**
 * The parity guards. `tsc` already refuses a missing or extra key — these catch
 * the two things it cannot see.
 */
describe('the dictionaries agree', () => {
  const enLeaves = flatten(en)
  const frLeaves = flatten(fr)

  it('use the same placeholders in both languages', () => {
    // The classic translation bug: "Held until {time}" becomes "Réservé jusqu'à
    // {heure}", the substitution silently misses, and the customer reads a brace.
    for (const [key, value] of Object.entries(enLeaves)) {
      expect(placeholders(frLeaves[key] ?? ''), key).toEqual(placeholders(value))
    }
  })

  /**
   * One apostrophe, not two.
   *
   * `fr.ts` shipped both — `dashboard.figures.today` had the curly one and
   * `todayDefinition` two lines below had the straight one — which is visible in
   * the product as two different glyphs in adjacent sentences, and invisible to
   * `tsc` and to the placeholder check. French needs an apostrophe in roughly a
   * fifth of its strings, so "whichever the keyboard produced" is not a policy.
   *
   * The curly one wins because it was already the majority and because it is
   * what typography wants; the straight one is a programmer's quote. English is
   * held to the same rule for the same reason — "nine o’clock" and "this week’s"
   * are the same decision.
   */
  it.each([
    ['en', enLeaves],
    ['fr', frLeaves],
  ])('use one kind of apostrophe in %s', (_language, leaves) => {
    const straight = Object.entries(leaves)
      .filter(([, value]) => value.includes("'"))
      .map(([key]) => key)
    expect(straight).toEqual([])
  })

  it('carry no empty string in either language', () => {
    for (const [key, value] of Object.entries(enLeaves)) {
      expect(value.trim(), `en.${key}`).not.toBe('')
      expect((frLeaves[key] ?? '').trim(), `fr.${key}`).not.toBe('')
    }
  })
})

/** Every leaf as `a.b.c` → the string, with plural forms flattened to `a.b.one`. */
function flatten(node: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  if (typeof node !== 'object' || node === null) return out
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out[path] = value
    else Object.assign(out, flatten(value, path))
  }
  return out
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort()
}
