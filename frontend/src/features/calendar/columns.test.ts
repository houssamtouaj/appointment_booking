import { describe, expect, it } from 'vitest'

import { dayColumns, nearestBusyDay, weekColumns } from '@/features/calendar/columns'
import type { Lookups } from '@/hooks/use-lookups'
import type { BookingSummary } from '@/types'

/**
 * Which column an appointment lands in — the one arithmetic mistake on this
 * screen that a person would act on.
 *
 * A tile drawn a few pixels off is a cosmetic defect. A tile in the wrong
 * *column* is an appointment on the wrong day, and the salon finds out when the
 * customer does not arrive on Tuesday. The zone is where that goes wrong: a
 * 23:40 Paris appointment read through a London browser belongs to the previous
 * calendar day, and every one of the assertions below would pass in Paris and
 * fail in London if anything here used the viewer's clock.
 *
 * Asserted on the dealing rather than through a rendered grid, because the
 * question is arithmetic and rendering it would mean asserting on pixels.
 */

const PARIS = 'Europe/Paris'
const WEEK = { from: '2026-08-31', to: '2026-09-06' }

const AMELIE = '33333333-3333-3333-3333-333333333333'
const MARC = '44444444-4444-4444-4444-444444444444'

function booking(overrides: Partial<BookingSummary> & { id: string }): BookingSummary {
  return {
    serviceId: '11111111-1111-1111-1111-111111111111',
    staffId: AMELIE,
    guestName: 'Yasmine Haddad',
    startsAt: '2026-09-01T08:00:00Z',
    endsAt: '2026-09-01T09:00:00Z',
    status: 'CONFIRMED',
    priceCents: 3500,
    ...overrides,
  }
}

const lookups: Lookups = {
  serviceById: new Map(),
  staffById: new Map([
    [AMELIE, { id: AMELIE, fullName: 'Amélie Rousseau' } as never],
    [MARC, { id: MARC, fullName: 'Marc Lefèvre' } as never],
  ]),
  isLoading: false,
  error: null,
}

describe('the week’s seven columns', () => {
  it('gives every day a column, including the empty ones', () => {
    // The difference between a calendar and a list. An empty Wednesday is
    // information — it is the day with room in it.
    const columns = weekColumns(WEEK, '2026-09-01', [booking({ id: 'a' })], PARIS)

    expect(columns).toHaveLength(7)
    expect(columns.map((column) => column.dayKey)).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ])
  })

  it('files a late-evening appointment under the business’s day, not the viewer’s', () => {
    // 2026-09-01T22:40Z is 00:40 on the 2nd in Paris. Read as UTC — or in
    // London — it would sit under Tuesday, one column to the left of where the
    // salon expects to find it.
    const columns = weekColumns(
      WEEK,
      '2026-09-01',
      [booking({ id: 'late', startsAt: '2026-09-01T22:40:00Z', endsAt: '2026-09-01T23:40:00Z' })],
      PARIS,
    )

    const tuesday = columns.find((column) => column.dayKey === '2026-09-01')
    const wednesday = columns.find((column) => column.dayKey === '2026-09-02')

    expect(tuesday?.bookings).toHaveLength(0)
    expect(wednesday?.bookings.map((b) => b.id)).toEqual(['late'])
  })

  it('files an appointment by where it starts, and only once', () => {
    // 23:30 to 00:30 local touches two days. Drawn twice it would double every
    // count on the screen; drawn on the day it ends it would move every late
    // booking to tomorrow.
    const columns = weekColumns(
      WEEK,
      '2026-09-01',
      [
        booking({
          id: 'overnight',
          startsAt: '2026-09-01T21:30:00Z',
          endsAt: '2026-09-01T22:30:00Z',
        }),
      ],
      PARIS,
    )

    const placed = columns.flatMap((column) => column.bookings)
    expect(placed).toHaveLength(1)
    expect(columns.find((column) => column.dayKey === '2026-09-01')?.bookings).toHaveLength(1)
  })

  it('orders a day by start, then by id, matching the API and the keyboard', () => {
    // Two colleagues genuinely do start at 09:00. Without the id tiebreak the
    // arrow keys visit them in a different order after every refetch.
    const columns = weekColumns(
      WEEK,
      '2026-09-01',
      [
        booking({ id: 'c', startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T11:00:00Z' }),
        booking({ id: 'b' }),
        booking({ id: 'a' }),
      ],
      PARIS,
    )

    expect(columns[1]?.bookings.map((b) => b.id)).toEqual(['a', 'b', 'c'])
  })

  it('says the count in the spoken label, where the column cannot be seen', () => {
    const columns = weekColumns(WEEK, '2026-09-01', [booking({ id: 'a' })], PARIS)

    expect(columns[1]?.label).toContain('1 appointment')
    expect(columns[1]?.label).toContain('today')
    expect(columns[2]?.label).toContain('no appointments')
    expect(columns[2]?.label).not.toContain('today')
  })
})

describe('the day’s staff columns', () => {
  it('gives a column to each colleague who has something on, and no one else', () => {
    // At 375px an empty column is width spent on nothing, and fitting is the
    // whole reason this view exists.
    const columns = dayColumns(
      '2026-09-01',
      '2026-09-01',
      [booking({ id: 'a' }), booking({ id: 'b', staffId: MARC })],
      PARIS,
      lookups,
    )

    expect(columns.map((column) => column.key).sort()).toEqual([AMELIE, MARC].sort())
  })

  it('orders columns by name, so a person’s column is where it was yesterday', () => {
    const columns = dayColumns(
      '2026-09-01',
      '2026-09-01',
      [booking({ id: 'a', staffId: MARC }), booking({ id: 'b' })],
      PARIS,
      lookups,
    )

    // Amélie before Marc, regardless of who appears first in the payload.
    expect(columns[0]?.key).toBe(AMELIE)
  })

  it('drops the rest of the week', () => {
    const columns = dayColumns(
      '2026-09-01',
      '2026-09-01',
      [
        booking({ id: 'today' }),
        booking({ id: 'friday', startsAt: '2026-09-04T08:00:00Z', endsAt: '2026-09-04T09:00:00Z' }),
      ],
      PARIS,
      lookups,
    )

    expect(columns.flatMap((column) => column.bookings).map((b) => b.id)).toEqual(['today'])
  })

  it('still draws a column on a day nobody is working', () => {
    // Without one the grid has no columns at all and collapses to a bare gutter.
    const columns = dayColumns('2026-09-02', '2026-09-01', [], PARIS, lookups)

    expect(columns).toHaveLength(1)
    expect(columns[0]?.bookings).toEqual([])
  })
})

describe('the nearest day with something on it', () => {
  const week = [
    booking({ id: 'mon', startsAt: '2026-08-31T08:00:00Z', endsAt: '2026-08-31T09:00:00Z' }),
    booking({ id: 'fri', startsAt: '2026-09-04T08:00:00Z', endsAt: '2026-09-04T09:00:00Z' }),
  ]

  it('prefers the next day forward when two are equally close', () => {
    // Wednesday sits exactly between them. A calendar is read forwards, and
    // somebody on an empty day is more often asking what is coming than what
    // they missed.
    expect(nearestBusyDay('2026-09-02', week, PARIS)).toBe('2026-09-04')
  })

  it('goes backwards when that is genuinely nearer', () => {
    expect(nearestBusyDay('2026-09-01', week, PARIS)).toBe('2026-08-31')
  })

  it('answers with the day itself when it is the busy one', () => {
    expect(nearestBusyDay('2026-08-31', week, PARIS)).toBe('2026-08-31')
  })

  it('has no answer for a week with nothing in it', () => {
    expect(nearestBusyDay('2026-09-02', [], PARIS)).toBeUndefined()
  })

  it('reads the day in the business zone, not the viewer’s', () => {
    // 22:40Z on the 1st is 00:40 on the 2nd in Paris — so from Wednesday, this
    // booking is *on* Wednesday, not a day away.
    const late = [
      booking({ id: 'late', startsAt: '2026-09-01T22:40:00Z', endsAt: '2026-09-01T23:40:00Z' }),
    ]
    expect(nearestBusyDay('2026-09-02', late, PARIS)).toBe('2026-09-02')
  })
})
