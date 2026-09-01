import { describe, expect, it } from 'vitest'

import { pollIntervalFor } from '@/features/booking/booking-queries'

/**
 * `pollIntervalFor` is exported with a stated reason — *"so the schedule can be
 * asserted directly rather than inferred from a test that waits ninety
 * seconds"* — and nothing named it. `manage-booking.test.tsx` covers the
 * behaviour well (it polls, it stops on a status change, it stops on unmount, it
 * gives up at ninety seconds, a second booking gets its own window); what it
 * cannot show without waiting is the shape of the curve in between.
 */

describe('the deposit-webhook poll schedule', () => {
  it('asks every two seconds while the webhook is plausibly in flight', () => {
    expect(pollIntervalFor(0)).toBe(2_000)
    expect(pollIntervalFor(19_999)).toBe(2_000)
  })

  it('backs off to five seconds at twenty', () => {
    // A webhook that has not landed in twenty seconds is not about to land in
    // the next two, and the page has another seventy to fill.
    expect(pollIntervalFor(20_000)).toBe(5_000)
    expect(pollIntervalFor(89_999)).toBe(5_000)
  })

  it('stops at ninety seconds rather than polling for the rest of the session', () => {
    // Past this it is an abandoned checkout, not a slow webhook — the sweeper
    // cancels it at thirty minutes (backend D3) — so the page offers a button
    // instead of asking again.
    expect(pollIntervalFor(90_000)).toBe(false)
    expect(pollIntervalFor(600_000)).toBe(false)
  })
})
