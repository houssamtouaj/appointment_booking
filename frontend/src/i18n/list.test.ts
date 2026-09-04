import { beforeEach, describe, expect, it } from 'vitest'

import { formatList } from '@/i18n/list'
import { resetLanguageStoreForTests, setLanguage } from '@/i18n/language'

/**
 * The list separator is the language's, not ours.
 *
 * Wave 10 replaced one `' and '` join with `Intl.ListFormat` and left three
 * `.join(', ')` calls behind — the unbookable chip's reason, the team row's
 * services, and the service row's `sr-only` sentence. A bare comma enumeration
 * is not wrong in either language, but English and French disagree about the
 * conjunction and about whether a comma precedes it, and a rule with three
 * exceptions inside the PR that wrote it is not a rule.
 */
describe('formatList', () => {
  beforeEach(() => {
    localStorage.clear()
    resetLanguageStoreForTests()
  })

  it('uses the language’s own conjunction', () => {
    expect(formatList(['Amélie', 'Marc'])).toBe('Amélie and Marc')
    setLanguage('fr')
    expect(formatList(['Amélie', 'Marc'])).toBe('Amélie et Marc')
  })

  it('punctuates three the way each language does', () => {
    // English is asserted as a property rather than as a literal, because the
    // region is the browser's: jsdom reports en-US and writes the Oxford comma,
    // Playwright pins en-GB and does not. Both are right, and neither is
    // something a `.join(', ')` could have produced.
    const english = formatList(['Monday', 'Tuesday', 'Saturday'])
    expect(english).toMatch(/^Monday, Tuesday,? and Saturday$/)

    setLanguage('fr')
    // No comma before "et", ever — the half a join cannot know.
    expect(formatList(['lundi', 'mardi', 'samedi'])).toBe('lundi, mardi et samedi')
  })

  it('leaves one item alone and answers empty for none', () => {
    expect(formatList(['Amélie'])).toBe('Amélie')
    expect(formatList([])).toBe('')
  })

  it('caches one formatter per locale rather than building one per call', () => {
    // Not observable through the return value, so it is asserted the only way it
    // can be: the same locale must not construct a second one. `Intl.ListFormat`
    // is expensive enough that a per-render construction is what sends people
    // back to `.join`.
    const built: string[] = []
    const Original = Intl.ListFormat
    class Counting extends Original {
      constructor(locale?: string | string[], options?: Intl.ListFormatOptions) {
        built.push(String(locale))
        super(locale, options)
      }
    }
    Object.defineProperty(Intl, 'ListFormat', { value: Counting, configurable: true })
    try {
      setLanguage('fr')
      formatList(['a', 'b'])
      formatList(['c', 'd'])
      formatList(['e', 'f'])
      // At most one construction for fr — and zero if an earlier case in this
      // file already warmed it, which is equally proof of the cache.
      expect(built.length).toBeLessThanOrEqual(1)
    } finally {
      Object.defineProperty(Intl, 'ListFormat', { value: Original, configurable: true })
    }
  })
})
