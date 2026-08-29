import { describe, expect, it } from 'vitest'

import { ApiError } from '@/api/error'
import { createQueryClient } from '@/api/query-client'

/**
 * The retry rule, read straight off the defaults rather than by observing a
 * query. Whether a 403 is retried is a decision, and a decision is worth
 * asserting directly.
 */
function retryDecision(failureCount: number, error: unknown): boolean {
  const retry = createQueryClient().getDefaultOptions().queries?.retry
  if (typeof retry !== 'function') throw new Error('the retry default is not a predicate')
  return retry(failureCount, error as Error)
}

function apiError(status: number) {
  return new ApiError({ code: 'INTERNAL_ERROR', status, detail: 'x' })
}

describe('the query client retry rule', () => {
  it.each([400, 401, 403, 404, 409, 422, 429])('never retries a %i', (status) => {
    // A 403 does not get better by asking again and a 422 is the same shape
    // every time. Three attempts is three times the latency before the empty
    // state a person could already have been reading.
    expect(retryDecision(0, apiError(status))).toBe(false)
  })

  it('retries a 5xx, twice at most', () => {
    expect(retryDecision(0, apiError(503))).toBe(true)
    expect(retryDecision(1, apiError(503))).toBe(true)
    expect(retryDecision(2, apiError(503))).toBe(false)
  })

  it('retries a request that never reached the server', () => {
    // Status 0 is what `toApiError` gives a network failure, because there is no
    // HTTP status to give it. A bare `>= 500` test would classify a dropped
    // packet as permanent — the one failure most worth retrying.
    expect(retryDecision(0, apiError(0))).toBe(true)
  })

  it('retries something that is not an ApiError at all', () => {
    expect(retryDecision(0, new TypeError('undefined is not a function'))).toBe(true)
  })

  it('never retries a mutation', () => {
    // A mutation is a side effect. Retrying one automatically is how a double
    // booking gets made out of a network blip.
    expect(createQueryClient().getDefaultOptions().mutations?.retry).toBe(false)
  })
})
