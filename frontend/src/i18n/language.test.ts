import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  LANGUAGE_STORAGE_KEY,
  currentLanguage,
  isLanguage,
  resetLanguageStoreForTests,
  setLanguage,
  subscribeToLanguage,
} from '@/i18n/language'

describe('the language store', () => {
  beforeEach(() => {
    localStorage.clear()
    resetLanguageStoreForTests()
  })

  it('derives English from an English browser, and stores nothing', () => {
    expect(currentLanguage()).toBe('en')
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull()
  })

  it('persists an explicit choice and stamps it on the document', () => {
    setLanguage('fr')
    expect(currentLanguage()).toBe('fr')
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('fr')
    expect(document.documentElement.lang).toBe('fr')
  })

  it('prefers a stored choice over the browser', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'fr')
    resetLanguageStoreForTests()
    expect(currentLanguage()).toBe('fr')
  })

  it('ignores a corrupted stored value rather than throwing', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de')
    resetLanguageStoreForTests()
    expect(currentLanguage()).toBe('en')
  })

  it('notifies every subscriber once per change', () => {
    let calls = 0
    const stop = subscribeToLanguage(() => {
      calls += 1
    })
    setLanguage('fr')
    expect(calls).toBe(1)
    stop()
    setLanguage('en')
    expect(calls).toBe(1)
  })

  it('answers the type guard for the two languages and nothing else', () => {
    expect(isLanguage('en')).toBe(true)
    expect(isLanguage('fr')).toBe(true)
    expect(isLanguage('es')).toBe(false)
  })
})

const INDEX_HTML = readFileSync(join(process.cwd(), 'index.html'), 'utf8')

/**
 * The body of the one inline script in index.html that mentions the language
 * key. Selected by content rather than by position, so adding a third pre-paint
 * script above it does not silently point this at the theme one.
 */
const PRE_PAINT_SCRIPT = (() => {
  const bodies = [...INDEX_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (match) => match[1] ?? '',
  )
  const found = bodies.filter((body) => body.includes(LANGUAGE_STORAGE_KEY))
  // Exactly one, or the selection below is guessing.
  expect(found).toHaveLength(1)
  return found[0] as string
})()

/**
 * Run that script against stubbed globals and report what it stamped.
 *
 * The three names it uses — `localStorage`, `navigator`, `document` — are free
 * identifiers in the source, so passing them as parameters shadows the real
 * ones. That is what makes this a test of the shipped bytes rather than of a
 * paraphrase: the string in `index.html` is the thing being executed.
 */
function stampedByScript(stored: string | null, languages: readonly string[]): string {
  const element = { lang: '' }
  const run = new Function('localStorage', 'navigator', 'document', PRE_PAINT_SCRIPT)
  run(
    { getItem: (key: string) => (key === LANGUAGE_STORAGE_KEY ? stored : null) },
    { languages: [...languages], language: languages[0] },
    { documentElement: element },
  )
  return element.lang
}

/** What `detect()` answers, reached through the store with `navigator` stubbed. */
function derivedByStore(stored: string | null, languages: readonly string[]): string {
  const original = Object.getOwnPropertyDescriptor(navigator, 'languages')
  Object.defineProperty(navigator, 'languages', { value: [...languages], configurable: true })
  try {
    localStorage.clear()
    if (stored !== null) localStorage.setItem(LANGUAGE_STORAGE_KEY, stored)
    resetLanguageStoreForTests()
    return currentLanguage()
  } finally {
    if (original) Object.defineProperty(navigator, 'languages', original)
    else Reflect.deleteProperty(navigator, 'languages')
    localStorage.clear()
    resetLanguageStoreForTests()
  }
}

describe('the pre-paint script in index.html', () => {
  // The script cannot import LANGUAGE_STORAGE_KEY: it runs before any module is
  // evaluated. This is the test that keeps the two copies of the string equal.
  it('reads the same storage key this module writes', () => {
    expect(INDEX_HTML).toContain(`localStorage.getItem('${LANGUAGE_STORAGE_KEY}')`)
  })

  it('stamps the document language, which is what a screen reader reads for voice', () => {
    expect(INDEX_HTML).toMatch(/document\.documentElement\.lang\s*=/)
  })

  /**
   * The real drift check, and the reason the old one was not.
   *
   * It asserted that the file *contained* the substring "navigator.language",
   * which "navigator.languages" satisfies too — so it went on passing while the
   * script read only the first tag and `detect()` walked the whole list. A
   * browser listing ['nl-BE', 'fr-BE'] rendered the app in French under
   * `<html lang="en">`: wrong screen-reader voice, wrong hyphenation, wrong
   * spell-check, which are the three things the script's own comment says it
   * exists for.
   */
  it.each([
    [null, ['en-GB']],
    [null, ['fr-FR']],
    [null, ['fr-CA', 'en-US']],
    // The case the substring assertion could not see.
    [null, ['nl-BE', 'fr-BE']],
    // No match anywhere in the list: both must land on English.
    [null, ['de-DE', 'nl-NL']],
    // A stored choice wins over the browser, in both directions.
    ['fr', ['en-GB']],
    ['en', ['fr-FR']],
    // A corrupted value is not a language and must fall through, not stick.
    ['de', ['fr-FR']],
  ] as const)('agrees with detect() for %s / %j', (stored, languages) => {
    expect(stampedByScript(stored, languages)).toBe(derivedByStore(stored, languages))
  })

  it('stamps a value on every path, so the static lang="en" is never the answer', () => {
    // Starting the stub at '' is what makes the English cases mean something:
    // a script that only corrected the French case would leave it empty here and
    // pass every assertion above by accident.
    expect(stampedByScript(null, ['en-GB'])).toBe('en')
    expect(stampedByScript(null, ['de-DE'])).toBe('en')
  })
})

describe('the store and the script cannot be left disagreeing', () => {
  it('stamps the derived language at module init, not only on a switch', () => {
    // `setLanguage` early-returns when the value has not changed, so nothing
    // stamped a *derived* French. `resetLanguageStoreForTests` re-runs the same
    // module-init path this pins.
    const original = Object.getOwnPropertyDescriptor(navigator, 'languages')
    Object.defineProperty(navigator, 'languages', {
      value: ['nl-BE', 'fr-BE'],
      configurable: true,
    })
    try {
      localStorage.clear()
      document.documentElement.lang = 'en'
      resetLanguageStoreForTests()
      expect(currentLanguage()).toBe('fr')
      expect(document.documentElement.lang).toBe('fr')
    } finally {
      if (original) Object.defineProperty(navigator, 'languages', original)
      else Reflect.deleteProperty(navigator, 'languages')
      localStorage.clear()
      resetLanguageStoreForTests()
    }
  })
})
