import { describe, expect, it } from 'vitest'

import { DEFAULT_AFTER_SIGN_IN, safeNextPath } from '@/features/auth/next-path'

describe('safeNextPath', () => {
  it('keeps an in-app path, query string and all', () => {
    expect(safeNextPath('/calendar')).toBe('/calendar')
    expect(safeNextPath('/calendar?view=week&staff=amelie')).toBe(
      '/calendar?view=week&staff=amelie',
    )
  })

  it('falls back when there is nothing to go back to', () => {
    expect(safeNextPath(null)).toBe(DEFAULT_AFTER_SIGN_IN)
    expect(safeNextPath('')).toBe(DEFAULT_AFTER_SIGN_IN)
  })

  it.each([
    ['an absolute URL', 'https://evil.example/steal'],
    ['a scheme-only URL', 'javascript:alert(1)'],
    // The one a `startsWith('/')` guard admits: the browser reads it as an
    // absolute URL to another host, and the sign-in flow lends it our
    // credibility.
    ['a protocol-relative URL', '//evil.example/steal'],
    ['the backslash spelling of the same trick', '/\\evil.example/steal'],
    ['a path with a newline in it', '/dashboard\nLocation: https://evil.example'],
  ])('refuses %s', (_description, value) => {
    expect(safeNextPath(value)).toBe(DEFAULT_AFTER_SIGN_IN)
  })
})
