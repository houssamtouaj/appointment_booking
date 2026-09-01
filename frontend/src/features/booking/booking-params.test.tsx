import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import {
  ANYONE,
  paramsForStep,
  stepOf,
  toSearch,
  useBookingParams,
} from '@/features/booking/booking-params'

/**
 * The URL is this flow's state, so the URL is an input — and `?date=` and
 * `?slot=` are the two parts of it a person can type, paste half of, or edit.
 * `next-path.ts`, the app's other URL guard, has a file like this one; these two
 * had nothing, and each is documented with the specific failure it prevents.
 *
 * Read through the hook rather than by exporting the two readers, because what
 * matters is what the flow *sees*: a rejected parameter has to arrive as
 * `undefined`, which is also what puts the customer on a step they can answer.
 */

function paramsAt(search: string) {
  const { result } = renderHook(() => useBookingParams(), {
    wrapper: ({ children }) => <MemoryRouter initialEntries={[search]}>{children}</MemoryRouter>,
  })
  return result.current
}

const SERVICE = '11111111-1111-1111-1111-111111111111'

describe('?date=', () => {
  it('takes a real day key', () => {
    expect(paramsAt('/b/x/book?date=2026-03-14').params.date).toBe('2026-03-14')
  })

  it('refuses a date the calendar does not have', () => {
    // The reason `isDayKey` does the work rather than `Date.parse`: V8 rolls
    // 2026-02-31 over to 3 March and would hand the picker a week it was never
    // asked for.
    expect(paramsAt('/b/x/book?date=2026-02-31').params.date).toBeUndefined()
    expect(paramsAt('/b/x/book?date=2026-13-01').params.date).toBeUndefined()
    expect(paramsAt('/b/x/book?date=2026-00-10').params.date).toBeUndefined()
  })

  it('refuses the shapes a truncated paste produces', () => {
    for (const raw of ['2026-3-14', '2026-03', '14/03/2026', 'today', '']) {
      expect(paramsAt(`/b/x/book?date=${raw}`).params.date).toBeUndefined()
    }
  })
})

describe('?slot=', () => {
  it('takes an instant verbatim, byte for byte', () => {
    // Never reparsed or reformatted: this exact string goes back as `startsAt`,
    // and one rebuilt from a local time and a zone is how a booking lands an
    // hour out on the last Sunday in March.
    const raw = '2026-03-14T09:30:00Z'
    expect(paramsAt(`/b/x/book?slot=${encodeURIComponent(raw)}`).params.slot).toBe(raw)
  })

  it('refuses an unparseable one rather than passing it on', () => {
    // Otherwise it reaches the details step, renders "Invalid Date" where the
    // appointment should be, and is sent to the API as `startsAt`.
    for (const raw of ['soon', '2026-03-14T', 'null', '']) {
      expect(paramsAt(`/b/x/book?slot=${encodeURIComponent(raw)}`).params.slot).toBeUndefined()
    }
  })

  it('sends the customer back to the step they can answer', () => {
    // A rejected slot is not an error page: with the service and the person
    // still in hand, the picker is the step this URL describes.
    const { params, step } = paramsAt(`/b/x/book?service=${SERVICE}&staff=${ANYONE}&slot=nonsense`)

    expect(params.slot).toBeUndefined()
    expect(step).toBe('slot')
  })
})

describe('the step the URL describes', () => {
  it('never runs ahead of an unmade choice', () => {
    // A `date` with no `service` is the service step, not the picker.
    expect(paramsAt('/b/x/book?date=2026-03-14').step).toBe('service')
    expect(stepOf({ serviceId: SERVICE })).toBe('staff')
    expect(stepOf({ serviceId: SERVICE, staff: ANYONE })).toBe('slot')
    expect(stepOf({ serviceId: SERVICE, staff: ANYONE, slot: '2026-03-14T09:30:00Z' })).toBe(
      'details',
    )
  })
})

describe('links back to an earlier step', () => {
  const full = {
    serviceId: SERVICE,
    staff: ANYONE,
    date: '2026-03-14' as const,
    slot: '2026-03-14T09:30:00Z',
  }

  it('carries everything up to the step and nothing after it', () => {
    expect(paramsForStep(full, 'service')).toEqual({})
    expect(paramsForStep(full, 'staff')).toEqual({ serviceId: SERVICE })
    // The week being looked at stays; the choice made in it goes, or the link
    // lands on step 4 again the instant it arrives.
    expect(paramsForStep(full, 'slot')).toEqual({
      serviceId: SERVICE,
      staff: ANYONE,
      date: '2026-03-14',
    })
    expect(paramsForStep(full, 'details')).toEqual(full)
  })

  it('writes only the parameters that have values', () => {
    expect(toSearch({})).toBe('')
    expect(toSearch({ serviceId: SERVICE, staff: ANYONE })).toBe(
      `?service=${SERVICE}&staff=${ANYONE}`,
    )
  })
})
