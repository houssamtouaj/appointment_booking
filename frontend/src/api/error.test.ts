import { renderHook } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'

import { ApiError, applyFieldErrors, isApiError, toApiError } from '@/api/error'
import { describeError } from '@/api/error-copy'

/**
 * A 422 exactly as the API sends one. Taken from `Problems.of` +
 * `addValidationErrors`: RFC 7807 members, plus `code` and a sorted `errors[]`.
 */
function validationProblem(errors: { field: string; message: string }[]) {
  const error = new Error('Request failed with status code 422') as Error & {
    isAxiosError: boolean
    response: unknown
    toJSON: () => object
  }
  error.isAxiosError = true
  error.response = {
    status: 422,
    data: {
      type: 'https://slotflow.dev/problems/validation-failed',
      title: 'Validation failed',
      status: 422,
      detail: 'The request contains invalid fields. See errors for the details.',
      code: 'VALIDATION_FAILED',
      errors,
    },
    headers: { 'x-request-id': 'req-42' },
  }
  error.toJSON = () => ({})
  return error
}

describe('toApiError', () => {
  it('reads code, detail and errors[] out of a problem body', () => {
    const error = toApiError(
      validationProblem([{ field: 'slug', message: 'must be 3-40 letters, digits or hyphens' }]),
    )

    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.status).toBe(422)
    expect(error.errors).toHaveLength(1)
    expect(error.requestId).toBe('req-42')
  })

  it('survives a response with a status and no problem body at all', () => {
    // A load balancer's 502, or a security filter that answered before the
    // dispatcher existed. A mapper that assumed a body throws a TypeError on top
    // of the failure it was meant to describe.
    const raw = new Error('Request failed with status code 502') as Error & {
      isAxiosError: boolean
      response: unknown
      toJSON: () => object
    }
    raw.isAxiosError = true
    raw.response = { status: 502, data: '<html>Bad Gateway</html>', headers: {} }
    raw.toJSON = () => ({})

    const error = toApiError(raw)

    expect(error.code).toBe('INTERNAL_ERROR')
    expect(error.status).toBe(502)
  })

  it('gives a request that never reached the server status 0', () => {
    const raw = new Error('Network Error') as Error & {
      isAxiosError: boolean
      toJSON: () => object
    }
    raw.isAxiosError = true
    raw.toJSON = () => ({})

    const error = toApiError(raw)

    expect(error.status).toBe(0)
    expect(error.isNetworkFailure).toBe(true)
    // Not retried-forever and not silently swallowed: the query client keys its
    // retry rule off exactly this.
    expect(describeError(error)).toMatch(/could not reach the server/i)
  })

  it('is idempotent, so a second call cannot double-wrap', () => {
    const first = toApiError(validationProblem([]))
    expect(toApiError(first)).toBe(first)
  })

  it('degrades an unknown code to the status-derived one instead of failing to parse', () => {
    // A backend that adds a code this bundle predates must not become an
    // unhandled parse failure in an already-deployed SPA.
    const raw = new Error('Request failed with status code 409') as Error & {
      isAxiosError: boolean
      response: unknown
      toJSON: () => object
    }
    raw.isAxiosError = true
    raw.response = {
      status: 409,
      data: { status: 409, code: 'INVENTED_IN_A_LATER_WAVE', detail: 'Nope' },
      headers: {},
    }
    raw.toJSON = () => ({})

    const error = toApiError(raw)

    expect(error.code).toBe('DATA_CONFLICT')
    expect(error.detail).toBe('Nope')
  })
})

describe('isApiError', () => {
  it('narrows, and asks which code when given one', () => {
    const error = new ApiError({ code: 'SLUG_TAKEN', status: 409, detail: 'taken' })

    expect(isApiError(error)).toBe(true)
    expect(isApiError(error, 'SLUG_TAKEN')).toBe(true)
    expect(isApiError(error, 'EMAIL_TAKEN')).toBe(false)
    expect(isApiError(error, 'EMAIL_TAKEN', 'SLUG_TAKEN')).toBe(true)
    expect(isApiError(new Error('nope'))).toBe(false)
  })
})

describe('applyFieldErrors', () => {
  function formWith(defaultValues: Record<string, unknown>) {
    return renderHook(() => useForm({ defaultValues })).result.current
  }

  /**
   * `getFieldState`, not `formState.errors`. The `formState` returned by
   * `renderHook` is a Proxy that only tracks what was read during a render, and
   * this test never renders again after `setError` — so reading `.errors` off
   * the captured object reports `undefined` for an error that is genuinely
   * there. `getFieldState` reads the live store.
   */
  function errorOn(form: ReturnType<typeof formWith>, path: string) {
    return form.getFieldState(path).error?.message
  }

  it('places every errors[] entry on the input it names', () => {
    const form = formWith({ slug: '', currency: '', guest: { email: '' } })

    const unmatched = applyFieldErrors(
      toApiError(
        validationProblem([
          { field: 'slug', message: 'must be 3-40 letters, digits or hyphens' },
          { field: 'currency', message: 'must be a three-letter ISO 4217 code' },
          // Nested, which is the shape a booking request actually sends.
          { field: 'guest.email', message: 'must be a well-formed email address' },
        ]),
      ),
      form,
    )

    expect(unmatched).toEqual([])
    expect(errorOn(form, 'slug')).toBe('must be 3-40 letters, digits or hyphens')
    expect(errorOn(form, 'currency')).toBe('must be a three-letter ISO 4217 code')
    expect(errorOn(form, 'guest.email')).toBe('must be a well-formed email address')
  })

  it('returns the entries that matched nothing rather than dropping them', () => {
    // React Hook Form accepts setError on an unregistered path without
    // complaint, so the naive version produces a form with no errors on it that
    // refuses to submit.
    const form = formWith({ password: '' })

    const unmatched = applyFieldErrors(
      toApiError(
        validationProblem([
          { field: 'password', message: 'must be at least 8 characters' },
          { field: 'token', message: 'must not be blank' },
        ]),
      ),
      form,
    )

    expect(unmatched).toEqual([{ field: 'token', message: 'must not be blank' }])
    expect(errorOn(form, 'password')).toBe('must be at least 8 characters')
  })

  it('honours a rename for the places a request nests what a form flattens', () => {
    const form = formWith({ email: '' })

    const unmatched = applyFieldErrors(
      toApiError(validationProblem([{ field: 'guest.email', message: 'must be an email' }])),
      form,
      { rename: { 'guest.email': 'email' } },
    )

    expect(unmatched).toEqual([])
    expect(errorOn(form, 'email')).toBe('must be an email')
  })

  it('does nothing for an error that is not a 422', () => {
    const form = formWith({ slug: '' })

    expect(
      applyFieldErrors(new ApiError({ code: 'SLUG_TAKEN', status: 409, detail: 'x' }), form),
    ).toEqual([])
    expect(errorOn(form, 'slug')).toBeUndefined()
  })
})

describe('describeError', () => {
  it('prefers the screen’s wording, then the shared table, then the server’s prose', () => {
    const unauthenticated = new ApiError({
      code: 'UNAUTHENTICATED',
      status: 401,
      detail: 'Bad credentials',
    })

    expect(
      describeError(unauthenticated, { UNAUTHENTICATED: 'Email or password is incorrect.' }),
    ).toBe('Email or password is incorrect.')
    expect(describeError(unauthenticated)).toBe('Please sign in and try again.')

    // A code with no entry anywhere falls back to `detail`, which is a good
    // sentence written by somebody who knew the context.
    const niche = new ApiError({
      code: 'TIMEZONE_SHIFT_UNCONFIRMED',
      status: 409,
      detail: 'Changing the timezone moves 14 future bookings.',
    })
    expect(describeError(niche)).toBe('Changing the timezone moves 14 future bookings.')
  })
})
