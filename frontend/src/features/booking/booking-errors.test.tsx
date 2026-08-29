import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { toApiError } from '@/api/error'
import { describeBookingFailure, type BookingRecovery } from '@/features/booking/booking-errors'
import { BookingFailureAlert } from '@/features/booking/booking-failure-alert'
import { addDays, todayIn } from '@/lib/time'
import type { ErrorCode } from '@/types'

/**
 * The wave gate, stated as a test: *every* code in the plan's step-2 table has
 * copy of its own, rendered from a body shaped like the one the API sends —
 * "not one generic error branch".
 *
 * The bodies below are not `{ code }` stubs. `Problems.of` sets `type`, `title`,
 * `status` and `code`, and `ApiException.with(...)` adds the members that carry
 * the actionable half of the refusal: `earliestStart`, `latestStart`,
 * `retryAfterSeconds`, the echoed slot. Those reach a screen only because
 * `problemDetailSchema` is a *loose* object — a strict one parses each of these
 * bodies successfully and silently drops the useful part — so a fixture without
 * them would let a regression through on exactly the line that regressed.
 */

const TZ = 'Europe/Paris'

/** An Axios rejection carrying an `application/problem+json` body, as the client sees one. */
function rejection(status: number, body: Record<string, unknown>): unknown {
  const error = new Error(String(status)) as Error & {
    isAxiosError: boolean
    response: unknown
    toJSON: () => object
  }
  error.isAxiosError = true
  error.response = { status, data: body, headers: {}, config: {} }
  error.toJSON = () => ({})
  return error
}

function problem(
  status: number,
  code: ErrorCode,
  detail: string,
  extra: Record<string, unknown> = {},
): unknown {
  return rejection(status, {
    type: `https://slotflow.app/problems/${code.toLowerCase().replace(/_/g, '-')}`,
    title: code,
    status,
    detail,
    code,
    ...extra,
  })
}

/** Three days out, so the two policy edges have a real day to name. */
const BOUNDARY = `${addDays(todayIn(TZ), 3)}T09:00:00Z`

const CASES: {
  code: ErrorCode
  error: unknown
  /** A phrase this code and no other produces. */
  says: RegExp
  recover: BookingRecovery
}[] = [
  {
    code: 'BOOKING_SLOT_TAKEN',
    // The body echoes the slot it lost, so a client can grey out exactly that
    // offer rather than reload the month.
    error: problem(409, 'BOOKING_SLOT_TAKEN', 'That slot has just been taken.', {
      staffId: '4e2ce84b-db0d-4502-b27e-8cb4a978884c',
      startsAt: BOUNDARY,
      endsAt: `${addDays(todayIn(TZ), 3)}T10:00:00Z`,
    }),
    says: /taken while you were filling this in/i,
    recover: 'slot',
  },
  {
    code: 'POLICY_LEAD_TIME',
    error: problem(422, 'POLICY_LEAD_TIME', 'This business needs more notice than that.', {
      earliestStart: BOUNDARY,
    }),
    says: /the earliest they can take you is/i,
    recover: 'slot',
  },
  {
    code: 'POLICY_MAX_ADVANCE',
    error: problem(
      422,
      'POLICY_MAX_ADVANCE',
      'That is further ahead than this business takes bookings.',
      { latestStart: BOUNDARY },
    ),
    says: /the latest they can take you is/i,
    recover: 'slot',
  },
  {
    code: 'SLOT_NOT_ON_GRID',
    error: problem(422, 'SLOT_NOT_ON_GRID', 'That is not one of the start times offered.', {
      startsAt: BOUNDARY,
      slotGranularityMinutes: 15,
    }),
    says: /no longer on offer/i,
    recover: 'slot',
  },
  {
    code: 'SLOT_OUTSIDE_HOURS',
    error: problem(422, 'SLOT_OUTSIDE_HOURS', 'Nobody is working then.', {
      startsAt: BOUNDARY,
    }),
    says: /no longer on offer/i,
    recover: 'slot',
  },
  {
    code: 'SERVICE_INACTIVE',
    error: problem(422, 'SERVICE_INACTIVE', 'service 09c7 is not bookable'),
    says: /no longer bookable/i,
    recover: 'service',
  },
  {
    code: 'STAFF_NOT_ASSIGNED',
    error: problem(
      422,
      'STAFF_NOT_ASSIGNED',
      'Nobody at this business currently performs that service.',
    ),
    says: /nobody here performs that service/i,
    recover: 'service',
  },
  {
    code: 'RATE_LIMITED',
    error: problem(429, 'RATE_LIMITED', 'Too many bookings from this email address.', {
      retryAfterSeconds: 47,
    }),
    says: /too many booking attempts/i,
    recover: 'stay',
  },
]

describe('every code in the table', () => {
  it.each(CASES)('$code renders its own copy', ({ error, says, recover }) => {
    const failure = describeBookingFailure(toApiError(error), TZ)

    render(<BookingFailureAlert failure={failure} />)

    expect(screen.getByRole('alert')).toHaveTextContent(says)
    expect(failure.recover).toBe(recover)
    // Never the raw enum name, which is the failure this whole table prevents.
    expect(screen.getByRole('alert')).not.toHaveTextContent(/[A-Z]{4,}_[A-Z]/)
  })

  it('gives no two of them the same title', () => {
    const titles = CASES.map(({ error }) => describeBookingFailure(toApiError(error), TZ).title)

    // `SLOT_NOT_ON_GRID` and `SLOT_OUTSIDE_HOURS` deliberately share one — they
    // are the same event to a customer, a stale tab — so the set is one smaller
    // than the list. Everything else is its own screen.
    expect(new Set(titles).size).toBe(CASES.length - 1)
  })
})

describe('the two policy edges', () => {
  it('name the day the server named, on the business clock', () => {
    const failure = describeBookingFailure(
      toApiError(problem(422, 'POLICY_LEAD_TIME', 'no', { earliestStart: BOUNDARY })),
      TZ,
    )

    // 09:00Z is 11:00 in Paris in summer. The point of the assertion is that the
    // boundary is read through the business's zone like everything else.
    expect(failure.description).toMatch(/at \d{2}:\d{2}\./)
    expect(failure.goToDate).toBe(addDays(todayIn(TZ), 3))
  })

  it('degrade to a sentence rather than to "Invalid Date" when the member is missing', () => {
    // A body with no `earliestStart` is not hypothetical — the member is added
    // at the throw site, and `ApiException.with` drops a null value silently. A
    // screen that formatted it unconditionally would render "Invalid Date".
    const failure = describeBookingFailure(toApiError(problem(422, 'POLICY_LEAD_TIME', 'no')), TZ)

    expect(failure.description).toBe('They need more notice than that. Please choose a later time.')
    expect(failure.goToDate).toBeUndefined()
    expect(failure.description).not.toMatch(/Invalid|NaN/)
  })

  it('ignores a boundary that is not a date', () => {
    const failure = describeBookingFailure(
      toApiError(problem(422, 'POLICY_MAX_ADVANCE', 'no', { latestStart: 'soon-ish' })),
      TZ,
    )

    expect(failure.goToDate).toBeUndefined()
    expect(failure.description).not.toMatch(/Invalid|NaN/)
  })
})

describe('the rate limit', () => {
  it('quotes the wait the server sent', () => {
    const failure = describeBookingFailure(
      toApiError(problem(429, 'RATE_LIMITED', 'no', { retryAfterSeconds: 47 })),
      TZ,
    )

    expect(failure.description).toContain('47 seconds')
  })

  it('rounds a long wait to minutes', () => {
    const failure = describeBookingFailure(
      toApiError(problem(429, 'RATE_LIMITED', 'no', { retryAfterSeconds: 300 })),
      TZ,
    )

    expect(failure.description).toContain('5 minutes')
  })

  it('falls back to a phrase when the header-equivalent member is absent', () => {
    const failure = describeBookingFailure(toApiError(problem(429, 'RATE_LIMITED', 'no')), TZ)

    expect(failure.description).toContain('a few minutes')
  })
})

describe('anything not in the table', () => {
  it('keeps the customer where they are rather than throwing away what they typed', () => {
    const failure = describeBookingFailure(toApiError(problem(500, 'INTERNAL_ERROR', 'boom')), TZ)

    expect(failure.recover).toBe('stay')
    expect(failure.title).toBe('This booking could not be completed')
  })

  it('survives a rejection that never reached the server', () => {
    const offline = new Error('Network Error') as Error & { isAxiosError: boolean }
    offline.isAxiosError = true

    const failure = describeBookingFailure(toApiError(offline), TZ)

    expect(failure.recover).toBe('stay')
    expect(failure.description).toMatch(/Could not reach the server/)
  })
})
