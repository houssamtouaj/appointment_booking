import { describe, expect, it } from 'vitest'

import {
  addRange,
  copyDay,
  draftFrom,
  draftToRequest,
  durationMinutes,
  isDirty,
  overlappingDays,
  rangeCount,
  rangeProblem,
  removeRange,
  setRange,
  toggleDay,
  type HoursDraft,
} from '@/features/hours/hours-model'
import { translateIn } from '@/i18n'
import type { WorkingHoursRange } from '@/types'

/**
 * The client's copy of one server-side rule, tested against the cases the server
 * tests.
 *
 * `overlappingDays` mirrors `WorkingHours.findOverlap`, and the point of the
 * mirror is that a person sees the collision while dragging rather than after a
 * round trip. A mirror that disagrees with the original is worse than no mirror:
 * it either refuses a week the API would have accepted, or promises one it will
 * refuse. So the awkward three are all here — the split shift with no gap, the
 * night shift, and the Sunday night shift that lands on Monday morning.
 */

function wire(dayOfWeek: WorkingHoursRange['dayOfWeek'], startTime: string, endTime: string) {
  return { dayOfWeek, startTime, endTime }
}

function open(draft: HoursDraft, day: WorkingHoursRange['dayOfWeek']) {
  const row = draft.find((entry) => entry.dayOfWeek === day)
  if (!row) throw new Error(`no row for ${day}`)
  return row
}

describe('the wire and the grid', () => {
  it('lays seven rows out Monday first, closed days included', () => {
    const draft = draftFrom([wire('WEDNESDAY', '09:00:00', '17:00:00')])

    expect(draft).toHaveLength(7)
    expect(draft.map((day) => day.dayOfWeek)[0]).toBe('MONDAY')
    expect(open(draft, 'WEDNESDAY').ranges).toHaveLength(1)
    expect(open(draft, 'SUNDAY').ranges).toEqual([])
  })

  it('trims the wire’s seconds for the inputs and puts them back on the way out', () => {
    const draft = draftFrom([wire('MONDAY', '09:00:00', '12:30:00')])

    expect(open(draft, 'MONDAY').ranges[0]).toMatchObject({ start: '09:00', end: '12:30' })
    expect(draftToRequest(draft).ranges).toEqual([
      { dayOfWeek: 'MONDAY', startTime: '09:00:00', endTime: '12:30:00' },
    ])
  })

  it('accepts a bare HH:mm from the API too — Jackson omits zero seconds', () => {
    const draft = draftFrom([wire('MONDAY', '09:00', '17:00')])

    expect(open(draft, 'MONDAY').ranges[0]).toMatchObject({ start: '09:00', end: '17:00' })
  })

  /**
   * The gate item, and the whole shape of the endpoint: what is not in the body
   * is gone. A day emptied in the grid must produce a request with no rows for
   * it, not a request that quietly omits the change.
   */
  it('sends a day that was emptied as an absence, which is what deletes it', () => {
    const loaded = draftFrom([
      wire('MONDAY', '09:00:00', '17:00:00'),
      wire('SATURDAY', '10:00:00', '14:00:00'),
    ])
    const closed = toggleDay(loaded, 'SATURDAY')

    expect(draftToRequest(closed).ranges).toEqual([
      { dayOfWeek: 'MONDAY', startTime: '09:00:00', endTime: '17:00:00' },
    ])
  })

  it('round-trips a day with three ranges, in the order it is worked', () => {
    const draft = draftFrom([
      wire('THURSDAY', '08:00:00', '11:00:00'),
      wire('THURSDAY', '12:00:00', '15:00:00'),
      wire('THURSDAY', '16:00:00', '19:00:00'),
    ])

    expect(rangeCount(draft)).toBe(3)
    expect(draftToRequest(draft).ranges.map((range) => range.startTime)).toEqual([
      '08:00:00',
      '12:00:00',
      '16:00:00',
    ])
  })
})

describe('a single range', () => {
  it('refuses equal times and allows a night shift', () => {
    expect(rangeProblem({ start: '09:00', end: '09:00' })).toBeTruthy()
    expect(rangeProblem({ start: '22:00', end: '02:00' })).toBeUndefined()
  })

  it('names its problem with a key both dictionaries answer', () => {
    // This module has no `t` and never will — it is pure, and `DayRow` renders
    // what it returns inside a `role="alert"`. Returning English put English in
    // that alert on the French hours screen, which is what this pins.
    for (const range of [
      { start: '' as const, end: '17:00' as const },
      { start: '09:00' as const, end: '09:00' as const },
    ]) {
      const key = rangeProblem(range)
      expect(key).toBeDefined()
      if (!key) continue
      expect(translateIn('en', key)).not.toBe(key)
      expect(translateIn('fr', key)).not.toBe(key)
      expect(translateIn('fr', key)).not.toBe(translateIn('en', key))
    }
  })

  it('measures a midnight crossing forwards, not backwards', () => {
    expect(durationMinutes({ start: '22:00', end: '02:00' })).toBe(240)
    expect(durationMinutes({ start: '09:00', end: '17:00' })).toBe(480)
  })
})

describe('overlap, across the week rather than within a day', () => {
  it('lets a split shift touch without overlapping', () => {
    const draft = draftFrom([
      wire('MONDAY', '09:00:00', '12:00:00'),
      wire('MONDAY', '12:00:00', '17:00:00'),
    ])

    expect(overlappingDays(draft).size).toBe(0)
  })

  it('catches two ranges of one day sharing a minute', () => {
    const draft = draftFrom([
      wire('MONDAY', '09:00:00', '13:00:00'),
      wire('MONDAY', '12:00:00', '17:00:00'),
    ])

    expect([...overlappingDays(draft)]).toEqual(['MONDAY'])
  })

  /**
   * The case that motivates the flattening. Neither range is wrong on its own
   * and they share no weekday, so a within-a-day check passes both — and the
   * server answers 422 for the hour they both claim on Tuesday morning.
   */
  it('catches a Monday night shift running into Tuesday morning', () => {
    const draft = draftFrom([
      wire('MONDAY', '22:00:00', '02:00:00'),
      wire('TUESDAY', '01:00:00', '03:00:00'),
    ])

    expect(overlappingDays(draft).size).toBeGreaterThan(0)
  })

  it('wraps a Sunday night shift round onto Monday', () => {
    const draft = draftFrom([
      wire('SUNDAY', '23:00:00', '03:00:00'),
      wire('MONDAY', '02:00:00', '06:00:00'),
    ])

    expect(overlappingDays(draft).size).toBeGreaterThan(0)
  })

  it('leaves a night shift alone when nothing meets it', () => {
    const draft = draftFrom([
      wire('MONDAY', '22:00:00', '02:00:00'),
      wire('TUESDAY', '09:00:00', '17:00:00'),
    ])

    expect(overlappingDays(draft).size).toBe(0)
  })

  /**
   * A cleared input is somebody mid-keystroke, not a collision. Treating an
   * empty end time as midnight would light the whole row red between the two
   * characters of an hour.
   */
  it('ignores a half-typed range rather than calling it an overlap', () => {
    const typing = addRange(draftFrom([wire('MONDAY', '09:00:00', '17:00:00')]), 'MONDAY')
    const key = open(typing, 'MONDAY').ranges[1]?.key ?? ''
    const halfTyped = setRange(
      setRange(typing, 'MONDAY', key, 'start', '10:00'),
      'MONDAY',
      key,
      'end',
      '',
    )

    expect(overlappingDays(halfTyped).size).toBe(0)
  })
})

describe('the edits', () => {
  it('opens a closed day on a sensible default and closes an open one entirely', () => {
    const closed = draftFrom([])
    const opened = toggleDay(closed, 'SUNDAY')

    expect(open(opened, 'SUNDAY').ranges).toHaveLength(1)
    expect(open(toggleDay(opened, 'SUNDAY'), 'SUNDAY').ranges).toEqual([])
  })

  it('starts a second shift where the first one ended, so adding one is never an overlap', () => {
    const draft = addRange(draftFrom([wire('MONDAY', '09:00:00', '12:00:00')]), 'MONDAY')

    expect(open(draft, 'MONDAY').ranges[1]).toMatchObject({ start: '12:00', end: '13:00' })
    expect(overlappingDays(draft).size).toBe(0)
  })

  it('removes the row it was asked for and leaves its neighbours keyed as they were', () => {
    const draft = draftFrom([
      wire('MONDAY', '09:00:00', '12:00:00'),
      wire('MONDAY', '13:00:00', '17:00:00'),
    ])
    const first = open(draft, 'MONDAY').ranges[0]?.key ?? ''
    const survivor = open(draft, 'MONDAY').ranges[1]

    const after = removeRange(draft, 'MONDAY', first)

    expect(open(after, 'MONDAY').ranges).toHaveLength(1)
    expect(open(after, 'MONDAY').ranges[0]?.key).toBe(survivor?.key)
  })

  it('copies Monday to the weekdays and leaves the weekend alone', () => {
    const draft = copyDay(draftFrom([wire('MONDAY', '09:00:00', '17:00:00')]), 'MONDAY', 'weekdays')

    expect(open(draft, 'FRIDAY').ranges[0]).toMatchObject({ start: '09:00', end: '17:00' })
    expect(open(draft, 'SATURDAY').ranges).toEqual([])
  })

  it('copies to all days, weekend included', () => {
    const draft = copyDay(draftFrom([wire('MONDAY', '09:00:00', '17:00:00')]), 'MONDAY', 'all')

    expect(rangeCount(draft)).toBe(7)
  })

  it('copies a closed day as closed, which is how a template is cleared', () => {
    const week = copyDay(draftFrom([wire('MONDAY', '09:00:00', '17:00:00')]), 'MONDAY', 'all')
    const cleared = copyDay(toggleDay(week, 'MONDAY'), 'MONDAY', 'all')

    expect(rangeCount(cleared)).toBe(0)
  })

  it('gives every copied row its own key, so two identical rows do not collide', () => {
    const draft = copyDay(draftFrom([wire('MONDAY', '09:00:00', '17:00:00')]), 'MONDAY', 'all')
    const keys = draft.flatMap((day) => day.ranges.map((range) => range.key))

    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('dirtiness', () => {
  const loaded = draftFrom([wire('MONDAY', '09:00:00', '17:00:00')])

  it('is false for a grid nobody has touched', () => {
    expect(isDirty(draftFrom([wire('MONDAY', '09:00:00', '17:00:00')]), loaded)).toBe(false)
  })

  it('is true for a changed time, an added row and a closed day alike', () => {
    const key = open(loaded, 'MONDAY').ranges[0]?.key ?? ''

    expect(isDirty(setRange(loaded, 'MONDAY', key, 'end', '18:00'), loaded)).toBe(true)
    expect(isDirty(addRange(loaded, 'MONDAY'), loaded)).toBe(true)
    expect(isDirty(toggleDay(loaded, 'MONDAY'), loaded)).toBe(true)
  })

  it('does not depend on the keys, which change on every reload', () => {
    expect(isDirty(draftFrom([wire('MONDAY', '09:00:00', '17:00:00')]), loaded)).toBe(false)
  })
})
