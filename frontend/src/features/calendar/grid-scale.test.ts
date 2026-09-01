import { describe, expect, it } from 'vitest'

import {
  buildScale,
  HOUR_REM,
  openBandOf,
  placeDay,
  remOf,
  spansOf,
  tailMinutes,
} from '@/features/calendar/grid-scale'
import { addDays, weekOf, type DayKey } from '@/lib/time'
import type { BookingSummary, OpeningHours } from '@/types'

/**
 * The composition its two sibling modules have tests for and it did not.
 *
 * `layout.test.ts` covers who overlaps whom, `columns.test.ts` covers what a
 * column is, and `lib/time.test.ts` covers `dayLengthMinutes` including a
 * `Europe/Paris` transition week. What was untested is the decision this file
 * makes out of them: **the longest day in view sets the scale**, and the short
 * day's leftover is marked rather than left blank. Its own doc names the failure
 * — a fixed 24 hours *"would push every afternoon appointment on the short day an
 * hour out of place"* — and nothing checked it, in this file or in
 * `calendar.test.tsx`.
 */

const PARIS = 'Europe/Paris'
/** Clocks go back: 03:00 CEST becomes 02:00 CET, so the day is 25 hours long. */
const FALL_BACK: DayKey = '2026-10-25'
/** Clocks go forward: 02:00 CET becomes 03:00 CEST, so the day is 23 hours long. */
const SPRING_FORWARD: DayKey = '2026-03-29'
const ROW_MINUTES = 15

const MINUTES_IN_DAY = 24 * 60

function week(anyDay: DayKey): DayKey[] {
  const range = weekOf(anyDay)
  return Array.from({ length: 7 }, (_, index) => addDays(range.from, index))
}

function booking(id: string, startsAt: string, endsAt: string): BookingSummary {
  return {
    id,
    startsAt,
    endsAt,
    status: 'CONFIRMED',
    guestName: 'A guest',
    serviceId: 'service-1',
    staffId: 'staff-1',
  } as BookingSummary
}

describe('the vertical scale', () => {
  it('is a plain minute-to-rem conversion, to four places', () => {
    expect(remOf(60)).toBe(`${HOUR_REM.toFixed(4)}rem`)
    expect(remOf(0)).toBe('0.0000rem')
    // 15 minutes is a quarter of an hour of grid, and the rounding is fixed
    // rather than floating so two adjacent tiles cannot disagree by a subpixel.
    expect(remOf(15)).toBe('0.8750rem')
  })
})

describe('an ordinary week', () => {
  const days = week('2026-09-02')

  it('is twenty-four hours tall', () => {
    expect(buildScale(days, PARIS, ROW_MINUTES).minutes).toBe(MINUTES_IN_DAY)
  })

  it('leaves no day with a tail', () => {
    const scale = buildScale(days, PARIS, ROW_MINUTES)
    for (const day of days) {
      expect(tailMinutes(day, PARIS, scale)).toBe(0)
    }
  })

  it('labels every hour of it', () => {
    // 00:00 through 23:00 — the marks are what the gutter draws, so a missing
    // one is a row line with no time against it.
    expect(buildScale(days, PARIS, ROW_MINUTES).marks).toHaveLength(24)
  })

  it('carries the ruling pitch through untouched', () => {
    // From `GET /api/policy`, and this file's job is to pass it on, not to have
    // an opinion about it.
    expect(buildScale(days, PARIS, 20).rowMinutes).toBe(20)
  })
})

describe('the week the clocks go forward', () => {
  const days = week(SPRING_FORWARD)

  it('scales to the twenty-four-hour days, not to the twenty-three-hour one', () => {
    // The whole point. Scaling to 23 hours would push every afternoon
    // appointment on the six normal days out of place instead.
    expect(buildScale(days, PARIS, ROW_MINUTES).minutes).toBe(MINUTES_IN_DAY)
  })

  it('marks the hour the short day does not have', () => {
    const scale = buildScale(days, PARIS, ROW_MINUTES)

    expect(tailMinutes(SPRING_FORWARD, PARIS, scale)).toBe(60)
    // And only that day. A tail on a normal day would be a band of shading over
    // an hour that exists.
    expect(tailMinutes(addDays(SPRING_FORWARD, -1), PARIS, scale)).toBe(0)
  })

  it('places an afternoon appointment against its own day, not against the scale', () => {
    // 15:00 Paris on the short day is 13:00 UTC, and it is 14 hours into a day
    // that began at 00:00 CET and lost 02:00 — so the tile belongs at 14h of
    // grid, not at 15h.
    const geometry = placeDay(
      [booking('b1', '2026-03-29T13:00:00Z', '2026-03-29T13:45:00Z')],
      SPRING_FORWARD,
      PARIS,
    )

    expect(geometry.get('b1')?.top).toBe(remOf(14 * 60))
    expect(geometry.get('b1')?.height).toBe(remOf(45))
  })
})

describe('the week the clocks go back', () => {
  const days = week(FALL_BACK)

  it('scales to the twenty-five-hour day, so the extra hour has somewhere to be', () => {
    expect(buildScale(days, PARIS, ROW_MINUTES).minutes).toBe(25 * 60)
  })

  it('gives the six normal days an hour of tail', () => {
    const scale = buildScale(days, PARIS, ROW_MINUTES)

    expect(tailMinutes(FALL_BACK, PARIS, scale)).toBe(0)
    for (const day of days.filter((day) => day !== FALL_BACK)) {
      expect(tailMinutes(day, PARIS, scale)).toBe(60)
    }
  })

  it('draws both passes of a repeated wall clock as two tiles, an hour apart', () => {
    // 02:30 happens twice. They are different appointments and the grid has room
    // for both precisely because the scale is 25 hours.
    const geometry = placeDay(
      [
        booking('first', '2026-10-25T00:30:00Z', '2026-10-25T01:00:00Z'),
        booking('second', '2026-10-25T01:30:00Z', '2026-10-25T02:00:00Z'),
      ],
      FALL_BACK,
      PARIS,
    )

    expect(geometry.get('first')?.top).toBe(remOf(2 * 60 + 30))
    expect(geometry.get('second')?.top).toBe(remOf(3 * 60 + 30))
  })
})

describe('an empty or degenerate week', () => {
  it('has no marks and no height rather than throwing', () => {
    const scale = buildScale([], PARIS, ROW_MINUTES)

    expect(scale.minutes).toBe(0)
    expect(scale.marks).toEqual([])
  })
})

describe('bookings as spans', () => {
  it('clamps a booking that started yesterday to the top of the column', () => {
    // Drawn from the top rather than above it, or it escapes the scroller.
    const spans = spansOf(
      [booking('overnight', '2026-09-01T20:00:00Z', '2026-09-02T06:00:00Z')],
      '2026-09-02',
      PARIS,
    )

    expect(spans[0]?.start).toBe(0)
    // Not clamped at the bottom: it does continue, and the column's overflow
    // clips it, which is the honest picture.
    expect(spans[0]?.end).toBeGreaterThan(0)
  })

  it('grows a five-minute booking to the floor, without moving anything else', () => {
    const geometry = placeDay(
      [
        booking('tiny', '2026-09-02T08:00:00Z', '2026-09-02T08:05:00Z'),
        booking('after', '2026-09-02T08:05:00Z', '2026-09-02T09:00:00Z'),
      ],
      '2026-09-02',
      PARIS,
    )

    // Ten minutes of drawing, not five — and the overlap decision was made on
    // the real times, so the neighbour still has the full width.
    expect(geometry.get('tiny')?.height).toBe(remOf(10))
    expect(geometry.get('tiny')?.width).toBe(geometry.get('after')?.width)
  })
})

describe('the open band', () => {
  const hours = (row: Partial<OpeningHours>): OpeningHours[] => [
    {
      dayOfWeek: 'WEDNESDAY',
      opensAt: '09:00',
      closesAt: '18:00',
      closesNextDay: false,
      ...row,
    } as OpeningHours,
  ]

  it('spans the business hours of the day it is asked about', () => {
    const days = week('2026-09-02')
    const scale = buildScale(days, PARIS, ROW_MINUTES)

    // 2026-09-02 is a Wednesday.
    const band = openBandOf('2026-09-02', hours({}), PARIS, scale)

    expect(band?.top).toBe(remOf(9 * 60))
    expect(band?.height).toBe(remOf(9 * 60))
  })

  it('runs to the bottom of the column for a shift that closes after midnight', () => {
    const scale = buildScale(week('2026-09-02'), PARIS, ROW_MINUTES)

    const band = openBandOf(
      '2026-09-02',
      hours({ opensAt: '18:00', closesAt: '02:00', closesNextDay: true }),
      PARIS,
      scale,
    )

    // Not a negative height wrapping around midnight: a salon closing at 02:00
    // is open past it, and the band ends where this column does.
    expect(band?.height).toBe(remOf(MINUTES_IN_DAY - 18 * 60))
  })

  it('draws nothing at all on a day the business is closed', () => {
    const scale = buildScale(week('2026-09-02'), PARIS, ROW_MINUTES)

    // A day with no row, rather than a band of zero height — which would render
    // as a hairline somebody has to explain.
    expect(openBandOf('2026-09-03', hours({}), PARIS, scale)).toBeUndefined()
    expect(openBandOf('2026-09-02', undefined, PARIS, scale)).toBeUndefined()
  })

  it('never draws past the bottom of the grid', () => {
    // The short day in a 24-hour week: a band that ignored the scale would hang
    // an hour below the last row line.
    const scale = buildScale(week(SPRING_FORWARD), PARIS, ROW_MINUTES)
    const band = openBandOf(
      SPRING_FORWARD,
      [
        {
          dayOfWeek: 'SUNDAY',
          opensAt: '09:00',
          closesAt: '02:00',
          closesNextDay: true,
        } as OpeningHours,
      ],
      PARIS,
      scale,
    )

    expect(Number.parseFloat(band?.height ?? '0')).toBeLessThanOrEqual(
      Number.parseFloat(remOf(scale.minutes)),
    )
  })
})
