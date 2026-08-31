import type { DayKey, DayRange } from '@/lib/time'

/**
 * The month the exceptions panel is showing, and the `from`/`to` it turns into.
 *
 * Both parameters on `GET /api/exceptions` are **required**, and a request that
 * sends neither is a 400 rather than an unbounded read. That is the wave's
 * sharpest watch-out, and the defence is structural rather than a guard: the
 * range is derived synchronously from a `yyyy-MM` string that always has a
 * value, so there is no state that arrives a render later and no window in which
 * the query could fire without one.
 *
 * Plain calendar arithmetic in UTC, like the rest of `lib/time`'s `DayKey`
 * helpers. A month has no zone — "September" is September everywhere — and the
 * only place the business timezone enters is the choice of which month is
 * *current*, which the caller passes in as today's `DayKey`.
 */

/** `2026-09`. */
export type MonthKey = string

/**
 * `2026-09`, and **the month has to be one of twelve**.
 *
 * `\d{2}` alone accepts `2026-13` and `2026-00`, which is not a hypothetical
 * shape: this reads a query string somebody can edit or link to. Either one
 * makes `monthRange` build `2026-13-01`, which the endpoint refuses with the 400
 * this file exists to make unrepresentable, and `formatMonth` render the words
 * "Invalid Date" into the picker and the empty state. Rejecting them here falls
 * back to the current month instead.
 */
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export function isMonthKey(raw: string | null): raw is MonthKey {
  return raw !== null && MONTH_PATTERN.test(raw)
}

/** The month a date falls in. `2026-09-14` → `2026-09`. */
export function monthOf(day: DayKey): MonthKey {
  return day.slice(0, 7)
}

/**
 * The first and last dates of the month, both inclusive — which is how the
 * endpoint reads them.
 *
 * `Date.UTC(year, month, 0)` is the last day of `month` counted from 1, which
 * is the one piece of `Date` arithmetic here and the only one that knows about
 * leap years so this file does not have to.
 */
export function monthRange(month: MonthKey): DayRange {
  const [year = '1970', index = '01'] = month.split('-')
  const last = new Date(Date.UTC(Number(year), Number(index), 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

/** The month `delta` months away, wrapping the year. */
export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const [year = '1970', index = '01'] = month.split('-')
  const moved = new Date(Date.UTC(Number(year), Number(index) - 1 + delta, 1))
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, '0')}`
}

/** `September 2026`. Noon UTC so the label cannot slide a day either way. */
export function formatMonth(month: MonthKey, locale?: string): string {
  const { from } = monthRange(month)
  return new Date(`${from}T12:00:00Z`).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
