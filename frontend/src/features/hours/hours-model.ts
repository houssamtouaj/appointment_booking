import { WEEKDAYS } from '@/lib/time'
import type { DayOfWeek, WorkingHoursRange, WorkingHoursRequest } from '@/types'

/**
 * The weekly grid as the form holds it, and the four questions it has to answer
 * without a round trip: is this day worked, do two ranges collide, has anything
 * changed, and what does the whole week look like on the wire.
 *
 * Pure, and separate from the components for one reason: the overlap rule is the
 * only piece of domain logic in this wave that the client re-implements, and a
 * re-implementation that is not tested against the same cases as the original is
 * a second opinion nobody asked for. `hours-model.test.ts` runs the awkward ones
 * — a split shift with no gap, a night shift, a Sunday night shift that lands on
 * Monday morning.
 */

/** `HH:mm`, which is what the inputs hold. The wire's seconds are trimmed on the way in. */
export type ClockTime = string

/**
 * One editable range.
 *
 * The `key` is React's, not the server's: `WorkingHoursRange` carries no id by
 * design, and rows are added, removed and reordered while somebody types. Keying
 * on the index would move a half-typed value to a different row when a range
 * above it is deleted, and keying on `start`-`end` would collide the moment two
 * rows are momentarily identical — which they are, every time a day is copied.
 */
export type DraftRange = { key: string; start: ClockTime; end: ClockTime }

/**
 * One row of the grid. **A day is closed exactly when it has no ranges** —
 * there is no separate `open` flag, because the wire has none either: a day
 * absent from the `PUT` is a day not worked. Keeping a boolean beside the list
 * would let the two disagree, and the disagreement would be invisible until a
 * save silently dropped somebody's Saturday.
 */
export type DraftDay = { dayOfWeek: DayOfWeek; ranges: DraftRange[] }

/** Seven entries, Monday first, always. */
export type HoursDraft = DraftDay[]

/** The default a day gets when it is opened with nothing in it. */
export const DEFAULT_RANGE: { start: ClockTime; end: ClockTime } = { start: '09:00', end: '17:00' }

/** `@Size(max = 70)` on the request. Ten shifts a day is already absurd. */
export const MAX_RANGES = 70

let nextKey = 0

function keyed(start: ClockTime, end: ClockTime): DraftRange {
  nextKey += 1
  return { key: `r${nextKey}`, start, end }
}

// ---------------------------------------------------------------------------
//  Wire ⇄ draft
// ---------------------------------------------------------------------------

/** `"09:00:00"` and `"09:00"` both arrive; the inputs want the second. */
function toClock(wire: string): ClockTime {
  return wire.slice(0, 5)
}

/**
 * `"09:00"` → `"09:00:00"`. Spring parses either, and sending the explicit form
 * keeps the request byte-identical to what the response will say it saved.
 */
function toWire(clock: ClockTime): string {
  return `${clock}:00`
}

/**
 * The response, laid out as seven rows.
 *
 * Days with nothing in them are still rows — the grid shows a closed Sunday
 * rather than six lines and a gap, for the same reason the public opening-hours
 * table does: a gap reads as missing data rather than as a shut door.
 */
export function draftFrom(ranges: readonly WorkingHoursRange[]): HoursDraft {
  return WEEKDAYS.map((dayOfWeek) => ({
    dayOfWeek,
    ranges: ranges
      .filter((range) => range.dayOfWeek === dayOfWeek)
      .map((range) => keyed(toClock(range.startTime), toClock(range.endTime))),
  }))
}

/**
 * The whole week, flattened — **including the days that are empty, by leaving
 * them out.**
 *
 * That sentence is the endpoint's contract and the reason this function has no
 * options: there is no partial send to build, and no shape of this request that
 * means "leave Thursday alone".
 */
export function draftToRequest(draft: HoursDraft): WorkingHoursRequest {
  return {
    ranges: draft.flatMap((day) =>
      day.ranges.map((range) => ({
        dayOfWeek: day.dayOfWeek,
        startTime: toWire(range.start),
        endTime: toWire(range.end),
      })),
    ),
  }
}

/** How many rows the week holds, against {@link MAX_RANGES}. */
export function rangeCount(draft: HoursDraft): number {
  return draft.reduce((total, day) => total + day.ranges.length, 0)
}

/**
 * Whether the grid differs from what was loaded.
 *
 * Compared as an ordered list of `day/start/end`, not as a set: the server
 * treats a reordered week as unchanged and answers a no-op, but the *guard* this
 * feeds is about whether somebody has edits they would lose, and moving a row
 * counts. Being too eager here costs a confirm nobody needed; being too relaxed
 * loses work.
 */
export function isDirty(draft: HoursDraft, baseline: HoursDraft): boolean {
  return signature(draft) !== signature(baseline)
}

function signature(draft: HoursDraft): string {
  return draft
    .flatMap((day) => day.ranges.map((range) => `${day.dayOfWeek}/${range.start}/${range.end}`))
    .join('|')
}

// ---------------------------------------------------------------------------
//  The two rules a person can break while typing
// ---------------------------------------------------------------------------

const MINUTES_PER_DAY = 24 * 60
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY

function minutesOf(clock: ClockTime): number {
  const [hours = '0', minutes = '0'] = clock.split(':')
  return Number(hours) * 60 + Number(minutes)
}

/**
 * How long a range lasts, **counting a midnight crossing correctly**.
 *
 * `endTime` earlier than `startTime` is a night shift and is legal — 22:00–02:00
 * is four hours, not minus twenty. Only equal times are meaningless, and
 * {@link rangeProblem} refuses those.
 */
export function durationMinutes(range: { start: ClockTime; end: ClockTime }): number {
  const start = minutesOf(range.start)
  const end = minutesOf(range.end)
  return end < start ? MINUTES_PER_DAY - start + end : end - start
}

/** The one thing wrong with a single range, or `undefined`. */
export function rangeProblem(range: { start: ClockTime; end: ClockTime }): string | undefined {
  if (!range.start || !range.end) return 'Both times are needed'
  if (range.start === range.end) return 'Start and end must differ'
  return undefined
}

/**
 * The weekdays whose ranges collide, laid out **across the week rather than
 * within a day**.
 *
 * This mirrors `WorkingHours.findOverlap`, and the flattening is the whole
 * reason it is not a simpler function. Two rows of one grid line is the case a
 * person hits; but a Monday 22:00–02:00 shift and a Tuesday 01:00–03:00 shift do
 * not share a weekday and *do* overlap in reality, on Tuesday morning. Laying
 * the week out as minutes from Monday midnight — with a Sunday night shift
 * wrapping round to Monday — makes both the same check, which is what the server
 * does and therefore what the client has to do to agree with it.
 *
 * Half-open intervals throughout, so a range ending at 12:00 and one starting at
 * 12:00 are adjacent rather than overlapping. That is what makes a split shift
 * with no gap expressible at all.
 *
 * The result is a set of days rather than a boolean because the grid marks the
 * offending rows; a single "something overlaps" would leave a person hunting
 * through seven days for it.
 */
export function overlappingDays(draft: HoursDraft): ReadonlySet<DayOfWeek> {
  type Span = { day: DayOfWeek; from: number; to: number }
  const spans: Span[] = []

  draft.forEach((day, index) => {
    for (const range of day.ranges) {
      if (rangeProblem(range)) continue
      const from = index * MINUTES_PER_DAY + minutesOf(range.start)
      const to = from + durationMinutes(range)
      if (to <= MINUTES_PER_WEEK) {
        spans.push({ day: day.dayOfWeek, from, to })
      } else {
        // A Sunday night shift finishes on Monday morning, which is *earlier* in
        // this coordinate system than it started. Two pieces, so the comparison
        // below stays a plain sort instead of modular arithmetic at every step.
        spans.push({ day: day.dayOfWeek, from, to: MINUTES_PER_WEEK })
        spans.push({ day: day.dayOfWeek, from: 0, to: to - MINUTES_PER_WEEK })
      }
    }
  })

  spans.sort((a, b) => a.from - b.from)

  const days = new Set<DayOfWeek>()
  for (let i = 1; i < spans.length; i += 1) {
    const current = spans[i]
    const previous = spans[i - 1]
    if (!current || !previous) continue
    // Sorted by start, so if any two spans overlap then some adjacent pair does.
    if (current.from < previous.to) {
      days.add(previous.day)
      days.add(current.day)
    }
  }
  return days
}

// ---------------------------------------------------------------------------
//  Edits
// ---------------------------------------------------------------------------

function replaceDay(draft: HoursDraft, dayOfWeek: DayOfWeek, ranges: DraftRange[]): HoursDraft {
  return draft.map((day) => (day.dayOfWeek === dayOfWeek ? { ...day, ranges } : day))
}

/** Open a closed day, or close an open one. Closing discards its ranges — that is what closed means. */
export function toggleDay(draft: HoursDraft, dayOfWeek: DayOfWeek): HoursDraft {
  const day = draft.find((row) => row.dayOfWeek === dayOfWeek)
  if (!day) return draft
  return replaceDay(
    draft,
    dayOfWeek,
    day.ranges.length > 0 ? [] : [keyed(DEFAULT_RANGE.start, DEFAULT_RANGE.end)],
  )
}

/**
 * A second (or third) shift on a day.
 *
 * The new row starts where the last one ended rather than at the default, which
 * is what a lunch break actually looks like to somebody filling this in — and it
 * is never an overlap, so the grid does not light up red the instant a row is
 * added.
 */
export function addRange(draft: HoursDraft, dayOfWeek: DayOfWeek): HoursDraft {
  const day = draft.find((row) => row.dayOfWeek === dayOfWeek)
  if (!day) return draft
  const last = day.ranges[day.ranges.length - 1]
  const start = last?.end ?? DEFAULT_RANGE.start
  const end = last ? addHour(start) : DEFAULT_RANGE.end
  return replaceDay(draft, dayOfWeek, [...day.ranges, keyed(start, end)])
}

export function removeRange(draft: HoursDraft, dayOfWeek: DayOfWeek, key: string): HoursDraft {
  const day = draft.find((row) => row.dayOfWeek === dayOfWeek)
  if (!day) return draft
  return replaceDay(
    draft,
    dayOfWeek,
    day.ranges.filter((range) => range.key !== key),
  )
}

export function setRange(
  draft: HoursDraft,
  dayOfWeek: DayOfWeek,
  key: string,
  edge: 'start' | 'end',
  value: ClockTime,
): HoursDraft {
  const day = draft.find((row) => row.dayOfWeek === dayOfWeek)
  if (!day) return draft
  return replaceDay(
    draft,
    dayOfWeek,
    day.ranges.map((range) => (range.key === key ? { ...range, [edge]: value } : range)),
  )
}

/** Monday to Friday. Saturday and Sunday are the two most people do *not* share. */
const WEEKDAY_NAMES: readonly DayOfWeek[] = WEEKDAYS.slice(0, 5)

/**
 * The two actions that make this screen bearable to fill in.
 *
 * Both copy the *source day's* ranges over every target, replacing whatever was
 * there — including emptying a day, if the source is closed. Copying a closed
 * Monday to all weekdays closes the week, which is the honest reading of the
 * button and is also how somebody clears a template they are about to rebuild.
 */
export function copyDay(draft: HoursDraft, from: DayOfWeek, scope: 'weekdays' | 'all'): HoursDraft {
  const source = draft.find((row) => row.dayOfWeek === from)
  if (!source) return draft
  const targets = scope === 'weekdays' ? WEEKDAY_NAMES : WEEKDAYS

  return draft.map((day) => {
    if (day.dayOfWeek === from || !targets.includes(day.dayOfWeek)) return day
    return { ...day, ranges: source.ranges.map((range) => keyed(range.start, range.end)) }
  })
}

function addHour(clock: ClockTime): ClockTime {
  const minutes = (minutesOf(clock) + 60) % MINUTES_PER_DAY
  const hours = Math.floor(minutes / 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
