import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { THEME_STORAGE_KEY, resetThemeStoreForTests, useTheme } from '@/hooks/use-theme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  resetThemeStoreForTests()
})

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('the theme toggle', () => {
  it('starts on system, with no attribute stamped', () => {
    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('cycles system → light → dark → system', () => {
    const { result } = renderHook(() => useTheme())

    act(() => result.current.cycleTheme())
    expect(result.current.theme).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    act(() => result.current.cycleTheme())
    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    act(() => result.current.cycleTheme())
    expect(result.current.theme).toBe('system')
    // Removed, not set to "system" — the media-query override in theme.css keys
    // off the absence of the attribute.
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('persists an explicit choice and clears it when returning to system', () => {
    const { result } = renderHook(() => useTheme())

    act(() => result.current.setTheme('dark'))
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')

    act(() => result.current.setTheme('system'))
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('keeps two mounted toggles in agreement', () => {
    const a = renderHook(() => useTheme())
    const b = renderHook(() => useTheme())

    act(() => a.result.current.setTheme('dark'))

    expect(b.result.current.theme).toBe('dark')
  })
})

// Not `new URL(..., import.meta.url)`: under the jsdom environment Vitest rewrites
// import.meta.url to an http: URL, and readFileSync rejects it. Vitest resolves cwd
// to the Vite config's root, which is this directory.
const INDEX_HTML = readFileSync(join(process.cwd(), 'index.html'), 'utf8')

describe('the pre-paint script in index.html', () => {
  // The script cannot import THEME_STORAGE_KEY: it runs before any module is
  // evaluated, which is the whole reason it exists. A rename on one side and not
  // the other produces a white flash that nothing else in the suite would catch.
  it('reads the same storage key this module writes', () => {
    expect(INDEX_HTML).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`)
  })

  it('stamps the attribute before the stylesheet is applied', () => {
    // Blocking and inline, in <head>. A deferred or module script runs after the
    // first paint, which is exactly the flash the wave 1 gate forbids.
    expect(INDEX_HTML).toMatch(/<script>\s*;?\(function/)
    expect(INDEX_HTML).not.toMatch(/<script\s+(defer|async|type="module")[^>]*>\s*;?\(function/)
  })
})
