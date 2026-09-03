import { beforeEach, describe, expect, it } from 'vitest'

import { ApiError } from '@/api/error'
import { describeError } from '@/api/error-copy'
import { errorCodeSchema, type ErrorCode } from '@/api/schemas/problem'
import { en } from '@/i18n/en'
import { fr } from '@/i18n/fr'
import { resetLanguageStoreForTests, setLanguage } from '@/i18n/language'

beforeEach(() => {
  localStorage.clear()
  resetLanguageStoreForTests()
})

const apiError = (code: ErrorCode, detail = 'Server prose') =>
  new ApiError({ code, status: 409, detail })

const networkError = () =>
  new ApiError({ code: 'INTERNAL_ERROR', status: 0, detail: 'The request did not reach us.' })

describe('the error dictionary', () => {
  it('covers every code the backend can send, in both languages', () => {
    // The gate this whole task exists for. A code added to the backend and
    // mirrored into problem.ts now fails here rather than falling through to an
    // English sentence in a French page.
    for (const code of errorCodeSchema.options) {
      expect(en.errors, `en.errors.${code}`).toHaveProperty(code)
      expect(fr.errors, `fr.errors.${code}`).toHaveProperty(code)
    }
  })
})

describe('describeError', () => {
  it('answers in the chosen language', () => {
    const error = apiError('SLUG_TAKEN')
    expect(describeError(error)).toBe(en.errors.SLUG_TAKEN)
    setLanguage('fr')
    expect(describeError(error)).toBe(fr.errors.SLUG_TAKEN)
  })

  it('prefers a screen override, which is now a key', () => {
    setLanguage('fr')
    // The sign-in form's wording for a code the rest of the app words generically
    // — the case `describeError`'s `overrides` parameter has always existed for.
    expect(
      describeError(apiError('UNAUTHENTICATED'), { UNAUTHENTICATED: 'errors.badCredentials' }),
    ).toBe(fr.errors.badCredentials)
  })

  it('keeps the server detail as the last resort', () => {
    // Unreachable now that every code has copy, and kept because "unreachable"
    // is a claim about today's backend. A code this bundle predates parses as
    // undefined (problem.ts .catch()) and lands here.
    const error = new ApiError({
      code: 'FUTURE_CODE' as ErrorCode,
      status: 500,
      detail: 'Some server prose',
    })
    expect(describeError(error)).toBe('Some server prose')
  })

  it('says the one thing there is to say about a network failure', () => {
    setLanguage('fr')
    expect(describeError(networkError())).toBe(fr.errors.networkFailure)
  })

  it('says something rather than nothing about a thing that is not an ApiError', () => {
    setLanguage('fr')
    expect(describeError(new Error('boom'))).toBe(fr.errors.unknown)
  })
})
