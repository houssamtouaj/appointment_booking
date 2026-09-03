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

describe('the pre-paint script in index.html', () => {
  // The script cannot import LANGUAGE_STORAGE_KEY: it runs before any module is
  // evaluated. This is the test that keeps the two copies of the string equal.
  it('reads the same storage key this module writes', () => {
    expect(INDEX_HTML).toContain(`localStorage.getItem('${LANGUAGE_STORAGE_KEY}')`)
  })

  it('stamps the document language, which is what a screen reader reads for voice', () => {
    expect(INDEX_HTML).toMatch(/document\.documentElement\.lang\s*=/)
  })

  it('falls back to the browser when nothing is stored', () => {
    expect(INDEX_HTML).toContain('navigator.language')
  })
})
