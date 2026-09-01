import { describe, expect, it } from 'vitest'

import {
  formatMonth,
  isMonthKey,
  monthOf,
  monthRange,
  shiftMonth,
} from '@/features/hours/month-range'

/**
 * Seventy-two lines of calendar arithmetic whose whole value is its edge cases,
 * each of them documented as deliberate and none of them exercised.
 * `hours.test.tsx` drives `monthRange` for exactly one ordinary month, and its
 * sibling `hours-model.ts` has a dedicated 259-line file.
 *
 * The three that matter: a month out of range reaching the API as `2026-13-01`,
 * February, and December wrapping into January.
 */

describe('the month key', () => {
  it('accepts the twelve real months', () => {
    for (let month = 1; month <= 12; month += 1) {
      expect(isMonthKey(`2026-${String(month).padStart(2, '0')}`)).toBe(true)
    }
  })

  it('refuses a two-digit number that is not a month', () => {
    // `\d{2}` alone would take both. This reads a query string somebody can edit
    // or link to, and either one makes `monthRange` build a date the endpoint
    // answers with a 400 and `formatMonth` render as "Invalid Date".
    expect(isMonthKey('2026-13')).toBe(false)
    expect(isMonthKey('2026-00')).toBe(false)
  })

  it('refuses the other shapes a hand-edited URL produces', () => {
    for (const raw of ['2026-9', '2026', '2026-09-14', '26-09', 'September', '', ' 2026-09']) {
      expect(isMonthKey(raw)).toBe(false)
    }
    expect(isMonthKey(null)).toBe(false)
  })
})

describe('the month a date falls in', () => {
  it('drops the day', () => {
    expect(monthOf('2026-09-14')).toBe('2026-09')
    expect(monthOf('2026-01-01')).toBe('2026-01')
    expect(monthOf('2026-12-31')).toBe('2026-12')
  })
})

describe('the range it turns into', () => {
  it('runs from the first to the last, both inclusive', () => {
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(monthRange('2026-07')).toEqual({ from: '2026-07-01', to: '2026-07-31' })
  })

  it('knows how long February is, in both kinds of year', () => {
    // The one piece of `Date` arithmetic in the file, and the reason it is there:
    // so nothing else has to know about leap years.
    expect(monthRange('2026-02').to).toBe('2026-02-28')
    expect(monthRange('2028-02').to).toBe('2028-02-29')
    // A century that is not a leap year, since the rule is not simply "every
    // fourth".
    expect(monthRange('2100-02').to).toBe('2100-02-28')
    expect(monthRange('2000-02').to).toBe('2000-02-29')
  })

  it('pads a single-digit day, so the API gets a real date', () => {
    // Not `2026-02-8`. Every date on the wire is `yyyy-MM-dd`.
    expect(monthRange('2026-01').from).toBe('2026-01-01')
    expect(monthRange('2026-11').to).toBe('2026-11-30')
  })
})

describe('stepping a month', () => {
  it('moves within a year', () => {
    expect(shiftMonth('2026-09', 1)).toBe('2026-10')
    expect(shiftMonth('2026-09', -1)).toBe('2026-08')
    expect(shiftMonth('2026-01', 5)).toBe('2026-06')
  })

  it('wraps the year in both directions', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })

  it('wraps more than a year at a time', () => {
    expect(shiftMonth('2026-06', 12)).toBe('2027-06')
    expect(shiftMonth('2026-06', -18)).toBe('2024-12')
  })

  it('returns a key its own guard accepts', () => {
    // The output feeds straight back into the URL, so a step that produced
    // `2027-1` would be read back as absent and silently reset the panel.
    for (const delta of [-25, -13, -1, 0, 1, 13, 25]) {
      expect(isMonthKey(shiftMonth('2026-06', delta))).toBe(true)
    }
  })
})

describe('the label', () => {
  it('names the month and the year', () => {
    expect(formatMonth('2026-09', 'en-GB')).toBe('September 2026')
    expect(formatMonth('2026-01', 'en-GB')).toBe('January 2026')
  })

  it('cannot slide a day either way', () => {
    // Noon UTC, so no viewer's offset can move the first of the month into the
    // last of the previous one.
    expect(formatMonth('2026-12', 'en-GB')).toBe('December 2026')
    expect(formatMonth('2026-03', 'en-GB')).toBe('March 2026')
  })
})
