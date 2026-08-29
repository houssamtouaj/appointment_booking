import { describe, expect, it } from 'vitest'

import type { Slot } from '@/types'
import {
  addDays,
  clockOf,
  dayKeyOf,
  daysBetween,
  formatDuration,
  groupSlotsByDay,
  isDayKey,
  partOfDay,
  splitByPartOfDay,
  weekOf,
  zoneAbbreviation,
  zoneCity,
  zonesAgree,
} from '@/lib/time'

/**
 * The wave's gate lives in this file. Each case is named after the bug it
 * prevents rather than the function it calls, and every expected value was
 * verified against the running API or against `Intl` before it was written down
 * — an assertion derived from the implementation proves only that the code does
 * what it does.
 *
 * These tests are correct whichever zone the runner is in. That is the point,
 * and it is checkable: `TZ=America/New_York npx vitest run src/lib/time.test.ts`
 * passes identically, and would not against an implementation that read a slot
 * through `new Date(iso).getDay()`.
 */

/**
 * Indexing under `noUncheckedIndexedAccess`. Throws rather than returning
 * `undefined`, so a grouping that produced fewer days than the case expects
 * fails as "no item at index 1" instead of as a confusing comparison against
 * undefined three lines later.
 */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index]
  if (item === undefined) throw new Error(`no item at index ${index}`)
  return item
}

/** Slots as the engine sends them: UTC instants, `staffIds` a union. */
function slot(start: string, ...staffIds: string[]): Slot {
  const end = new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString()
  return {
    start,
    end: end.replace('.000Z', 'Z'),
    staffIds: staffIds.length > 0 ? staffIds : ['4e2ce84b-db0d-4502-b27e-8cb4a978884c'],
  }
}

describe('day grouping across the business timezone', () => {
  // The gate's named case. 23:40Z is 01:40 the next morning in Paris, and the
  // slot belongs to the day the salon will be open — not to the day the UTC
  // string starts with.
  it('groups a 23:40Z slot under the following Paris day', () => {
    const days = groupSlotsByDay([slot('2026-08-31T23:40:00Z')], 'Europe/Paris')

    expect(days).toHaveLength(1)
    expect(at(days, 0).dayKey).toBe('2026-09-01')
    expect(clockOf(at(at(days, 0).slots, 0).start, 'Europe/Paris')).toBe('01:40')
  })

  it('groups the same 23:40Z slot under the correct London day when the business is in London', () => {
    const days = groupSlotsByDay([slot('2026-08-31T23:40:00Z')], 'Europe/London')

    expect(at(days, 0).dayKey).toBe('2026-09-01')
    expect(clockOf(at(at(days, 0).slots, 0).start, 'Europe/London')).toBe('00:40')
  })

  // The discriminating case, and the reason the two above are not enough: here
  // the two zones genuinely disagree about which day it is. An implementation
  // that grouped by UTC, or by the viewer's zone, gets exactly one of these
  // right and looks correct while doing it.
  it('puts one instant on different days for a Paris business and a London one', () => {
    const late = slot('2026-08-31T22:40:00Z')

    expect(at(groupSlotsByDay([late], 'Europe/Paris'), 0).dayKey).toBe('2026-09-01')
    expect(at(groupSlotsByDay([late], 'Europe/London'), 0).dayKey).toBe('2026-08-31')
  })

  it('sorts days ascending and slots within a day by instant', () => {
    const days = groupSlotsByDay(
      [slot('2026-09-02T09:00:00Z'), slot('2026-08-31T14:00:00Z'), slot('2026-08-31T08:15:00Z')],
      'Europe/Paris',
    )

    expect(days.map((day) => day.dayKey)).toEqual(['2026-08-31', '2026-09-02'])
    expect(at(days, 0).slots.map((s) => clockOf(s.start, 'Europe/Paris'))).toEqual([
      '10:15',
      '16:00',
    ])
  })
})

describe('slot starts the engine actually produces', () => {
  // The watch-out this fixture exists for: the engine walks its grid from each
  // opening-hours window rather than from the hour, so starts are not aligned to
  // :00/:15/:30/:45. The demo returns minutes 00,05,10,...,55 — verified against
  // the running API — and any layout that assumes a quarter-hour drops slots.
  it('renders non-round minutes exactly as the API returned them', () => {
    const starts = [
      '2026-08-31T13:10:00Z',
      '2026-08-31T13:35:00Z',
      '2026-08-31T13:55:00Z',
      '2026-08-31T15:05:00Z',
    ]
    const days = groupSlotsByDay(
      starts.map((s) => slot(s)),
      'Europe/Paris',
    )

    expect(at(days, 0).slots.map((s) => clockOf(s.start, 'Europe/Paris'))).toEqual([
      '15:10',
      '15:35',
      '15:55',
      '17:05',
    ])
  })
})

describe('a DST-transition week', () => {
  // Europe/Paris ends DST on 2026-10-25: 03:00 CEST becomes 02:00 CET, so the
  // wall clock 02:30 happens twice. The engine returns what it returns; the
  // grouping's only job is to drop, duplicate and misdate nothing.
  const fallBackNight = [
    slot('2026-10-24T23:30:00Z'), // 01:30 CEST
    slot('2026-10-25T00:30:00Z'), // 02:30 CEST — the first pass
    slot('2026-10-25T01:30:00Z'), // 02:30 CET  — the second pass, same clock
    slot('2026-10-25T02:30:00Z'), // 03:30 CET
  ]

  it('keeps every slot on the night the clocks go back', () => {
    const days = groupSlotsByDay(fallBackNight, 'Europe/Paris')
    const all = days.flatMap((day) => day.slots)

    expect(all).toHaveLength(fallBackNight.length)
    expect(new Set(all.map((s) => s.start)).size).toBe(fallBackNight.length)
  })

  it('dates all four to 25 October rather than splitting them across midnight', () => {
    const days = groupSlotsByDay(fallBackNight, 'Europe/Paris')

    expect(days).toHaveLength(1)
    expect(at(days, 0).dayKey).toBe('2026-10-25')
  })

  it('renders the repeated wall clock twice rather than deduping two real offers', () => {
    // Two distinct instants that a customer sees as the same time. They are
    // different appointments; collapsing them would delete a bookable hour.
    const clocks = at(groupSlotsByDay(fallBackNight, 'Europe/Paris'), 0).slots.map((s) =>
      clockOf(s.start, 'Europe/Paris'),
    )

    expect(clocks).toEqual(['01:30', '02:30', '02:30', '03:30'])
  })

  it('does not invent a slot in the hour that spring-forward skips', () => {
    // 2026-03-29: 02:00 CET jumps to 03:00 CEST. 00:30Z is 01:30 and 01:30Z is
    // 03:30 — nothing renders as 02:xx, because nothing happened then.
    const days = groupSlotsByDay(
      [slot('2026-03-29T00:30:00Z'), slot('2026-03-29T01:30:00Z')],
      'Europe/Paris',
    )

    expect(at(days, 0).slots.map((s) => clockOf(s.start, 'Europe/Paris'))).toEqual([
      '01:30',
      '03:30',
    ])
    expect(at(days, 0).dayKey).toBe('2026-03-29')
  })
})

describe('deduping by start', () => {
  // The engine already unions — 163 demo slots, zero repeated starts, 27 rows
  // with two staff. This is the guard for if that ever stops being true.
  it('merges two rows at the same start and unions their staff', () => {
    const days = groupSlotsByDay(
      [slot('2026-09-01T10:00:00Z', 'staff-a'), slot('2026-09-01T10:00:00Z', 'staff-b')],
      'Europe/Paris',
    )

    expect(at(days, 0).slots).toHaveLength(1)
    expect([...at(at(days, 0).slots, 0).staffIds].sort()).toEqual(['staff-a', 'staff-b'])
  })

  it('keeps a slot that only one staff member can take', () => {
    const days = groupSlotsByDay([slot('2026-09-01T10:00:00Z', 'staff-a')], 'Europe/Paris')

    expect(at(at(days, 0).slots, 0).staffIds).toEqual(['staff-a'])
  })
})

describe('part of day', () => {
  it('splits on the business clock, not on UTC', () => {
    // 08:15Z is 10:15 in Paris — morning. 13:45Z is 15:45 — afternoon. 16:30Z is
    // 18:30 — evening. Read as UTC, the last two would both be afternoon.
    expect(partOfDay('2026-08-31T08:15:00Z', 'Europe/Paris')).toBe('morning')
    expect(partOfDay('2026-08-31T13:45:00Z', 'Europe/Paris')).toBe('afternoon')
    expect(partOfDay('2026-08-31T16:30:00Z', 'Europe/Paris')).toBe('evening')
  })

  it('drops the parts of the day that have no slots', () => {
    const groups = splitByPartOfDay(
      [slot('2026-08-31T08:15:00Z'), slot('2026-08-31T13:45:00Z')],
      'Europe/Paris',
    )

    expect(groups.map((group) => group.part)).toEqual(['morning', 'afternoon'])
  })
})

describe('calendar arithmetic on a day key', () => {
  it('crosses a month end', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('crosses a DST boundary without losing a day', () => {
    // The classic failure of hour-based date maths: 24 hours after 25 October in
    // Paris is 23 hours of clock, and an implementation working in local
    // milliseconds lands back on the 25th.
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26')
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2)
  })

  it('finds the Monday of a week, and the Sunday that closes it', () => {
    // 2026-09-02 is a Wednesday.
    expect(weekOf('2026-09-02')).toEqual({ from: '2026-08-31', to: '2026-09-06' })
  })

  it('treats a Sunday as the end of its week, not the start of the next', () => {
    expect(weekOf('2026-09-06')).toEqual({ from: '2026-08-31', to: '2026-09-06' })
  })

  it('leaves a Monday where it is', () => {
    expect(weekOf('2026-08-31').from).toBe('2026-08-31')
  })

  it('finds the day in the business zone, which is not always the day where the viewer is', () => {
    expect(dayKeyOf('2026-08-31T22:40:00Z', 'Europe/Paris')).toBe('2026-09-01')
    expect(dayKeyOf('2026-08-31T22:40:00Z', 'America/New_York')).toBe('2026-08-31')
  })
})

describe('telling the viewer which clock they are reading', () => {
  const summer = new Date('2026-08-31T12:00:00Z')

  it('stays quiet when two different zones are on the same offset', () => {
    // Berlin and Paris are the same clock to the minute. A banner here is noise
    // that teaches people to ignore the banner that matters.
    expect(zonesAgree('Europe/Berlin', 'Europe/Paris', summer)).toBe(true)
  })

  it('speaks up when the offsets genuinely differ', () => {
    expect(zonesAgree('America/New_York', 'Europe/Paris', summer)).toBe(false)
    expect(zonesAgree('Europe/London', 'Europe/Paris', summer)).toBe(false)
  })

  it('names the city rather than the country', () => {
    expect(zoneCity('Europe/Paris')).toBe('Paris')
    expect(zoneCity('America/New_York')).toBe('New York')
  })
})

describe('a zone this browser has never heard of', () => {
  // The payload does not validate `zoneId` against the tz database on purpose —
  // the server's copy and the viewer's can differ by a release. That trade needs
  // a fallback at the far end, because `Intl` throws from inside a render and
  // there is no boundary above these screens to catch it.
  const unknown = 'Mars/Olympus_Mons'

  it('reads times in UTC instead of throwing a RangeError mid-render', () => {
    expect(() => dayKeyOf('2026-08-31T22:40:00Z', unknown)).not.toThrow()
    expect(dayKeyOf('2026-08-31T22:40:00Z', unknown)).toBe('2026-08-31')
    expect(clockOf('2026-08-31T22:40:00Z', unknown)).toBe('22:40')
    expect(partOfDay('2026-08-31T22:40:00Z', unknown)).toBe('evening')
  })

  it('labels the degraded times UTC rather than naming a city they are not on', () => {
    expect(zoneCity(unknown)).toBe('UTC')
    expect(zoneAbbreviation(unknown, new Date('2026-08-31T12:00:00Z'), 'en-GB')).toBe('UTC')
    expect(zonesAgree(unknown, 'UTC')).toBe(true)
  })
})

describe('a day key from the URL', () => {
  it('accepts a real date', () => {
    expect(isDayKey('2026-08-31')).toBe(true)
    expect(isDayKey('2026-02-28')).toBe(true)
    // 2028 is a leap year, so this one exists.
    expect(isDayKey('2028-02-29')).toBe(true)
  })

  it('rejects a well-formed date that does not exist', () => {
    // The case `Date.parse` does not catch: V8 rolls these over to 3 March and
    // 1 May rather than returning NaN, so a picker trusting it opens on a week
    // nobody asked for.
    expect(isDayKey('2026-02-31')).toBe(false)
    expect(isDayKey('2026-04-31')).toBe(false)
    expect(isDayKey('2026-02-29')).toBe(false)
  })

  it('rejects anything that is not a calendar date at all', () => {
    expect(isDayKey('2026-13-01')).toBe(false)
    expect(isDayKey('2026-00-10')).toBe(false)
    expect(isDayKey('31-08-2026')).toBe(false)
    expect(isDayKey('')).toBe(false)
  })
})

describe('durations', () => {
  it('reads the demo catalogue back the way a person would say it', () => {
    expect(formatDuration(20)).toBe('20 min')
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(60)).toBe('1 hr')
    expect(formatDuration(90)).toBe('1 hr 30 min')
  })
})
