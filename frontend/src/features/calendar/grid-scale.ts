import { frameOf, layOutSpans, type Span } from '@/features/calendar/layout'
import {
  dayLengthMinutes,
  hourMarks,
  localTimeMinutesIntoDay,
  minutesIntoDay,
  weekdayOf,
  type DayKey,
  type HourMark,
} from '@/lib/time'
import type { BookingSummary, OpeningHours } from '@/types'

/**
 * Minutes to lengths — the arithmetic both grids position everything with.
 *
 * Split out from the components because it is the half that can be wrong without
 * looking wrong, and because the week grid and the day grid share every line of
 * it. They differ only in what a column *is*: seven days in one, one day and its
 * staff in the other.
 */

/**
 * How tall an hour is.
 *
 * 3.5rem — 56px at the default root size — which is the smallest pitch at which
 * a 15-minute row is still a comfortable pointer target (14px) and a 30-minute
 * booking can hold two lines of 11px text. Below it the quarter-hour ruling
 * turns into hatching; above it a working day stops fitting on a laptop screen
 * without scrolling, and scrolling past the morning to find the afternoon is the
 * thing a week view exists to avoid.
 *
 * A module constant rather than a theme token because it is not a design
 * primitive that anything else may reach for — it is this screen's scale, and
 * the tokens deliberately have no word for it.
 */
/** Where a tile sits, as the grid worked it out. All four are CSS lengths. */
export type TileGeometry = {
  top: string
  height: string
  left: string
  width: string
}

export const HOUR_REM = 3.5

const REM_PER_MINUTE = HOUR_REM / 60

/**
 * A rem length in CSS pixels, read from the document's own root size.
 *
 * Read rather than assumed to be 16: a viewer who has set a larger default font
 * gets a proportionally taller grid, and a scroll offset computed against a
 * hard-coded 16 would land them somewhere other than where the appointments are.
 * Falls back to 16 outside a document, which is where the tests run.
 */
export function remToPx(rem: number): number {
  if (typeof document === 'undefined') return rem * 16
  const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  return rem * (Number.isFinite(root) && root > 0 ? root : 16)
}

/** Minutes as a CSS length on the grid's vertical scale. */
export function remOf(minutes: number): string {
  return `${(minutes * REM_PER_MINUTE).toFixed(4)}rem`
}

export type GridScale = {
  /** The height of the grid, in minutes. The longest day in view. */
  minutes: number
  /** Where the labelled hour lines fall, and what each says. */
  marks: HourMark[]
  /** The unlabelled ruling between them, from `GET /api/policy`. */
  rowMinutes: number
}

/**
 * One scale for however many days are on screen.
 *
 * **The longest day wins**, and on 51 weeks of the year every day is the same
 * length and the choice does not arise. On the two that transition it does, and
 * the alternative — a fixed 24 hours — is the watch-out this wave is warned
 * about: it would push every afternoon appointment on the short day an hour out
 * of place.
 *
 * What the longest day buys is that the row lines are *true for at least one
 * column* and every column is positioned against its own day's real length, so
 * no appointment is ever drawn against the wrong time. What it costs is that a
 * 23-hour day in a week containing a 24-hour one ends an hour before the bottom
 * of the grid, which {@link tailMinutes} marks rather than leaves as a blank
 * that reads like a rendering fault.
 */
export function buildScale(
  days: readonly DayKey[],
  timeZone: string,
  rowMinutes: number,
): GridScale {
  let longest = days[0] ?? ''
  let minutes = 0

  for (const day of days) {
    const length = dayLengthMinutes(day, timeZone)
    if (length > minutes) {
      minutes = length
      longest = day
    }
  }

  return { minutes, marks: longest ? hourMarks(longest, timeZone) : [], rowMinutes }
}

/** How much of the grid is *not* part of this day. Zero on all but a DST week. */
export function tailMinutes(dayKey: DayKey, timeZone: string, scale: GridScale): number {
  return scale.minutes - dayLengthMinutes(dayKey, timeZone)
}

/**
 * A day's bookings as spans on that day's scale.
 *
 * Clamped at the top and not at the bottom, deliberately. A booking that started
 * yesterday has a negative start and must be drawn from the top of the column
 * rather than above it, or it escapes the scroller; one that runs past midnight
 * is left long and clipped by the column's own overflow, which is the honest
 * picture — it does continue.
 */
export function spansOf(
  bookings: readonly BookingSummary[],
  dayKey: DayKey,
  timeZone: string,
): Span[] {
  return bookings.map((booking) => ({
    key: booking.id,
    start: Math.max(0, minutesIntoDay(booking.startsAt, dayKey, timeZone)),
    end: minutesIntoDay(booking.endsAt, dayKey, timeZone),
  }))
}

/**
 * The smallest a tile may be drawn, in minutes of the scale.
 *
 * A 5-minute booking is 4.7px tall at this scale, which is below the 24px a
 * pointer target needs and far below what two words of text need. Ten minutes —
 * about 9px — is still small, and it is a floor on the *drawing* only: the
 * layout algorithm has already decided who overlaps whom using the real times,
 * so growing a tile here cannot push another one aside or hide it.
 */
const MINIMUM_TILE_MINUTES = 10

/** Every booking of one day, placed: overlap columns crossed with the vertical scale. */
export function placeDay(
  bookings: readonly BookingSummary[],
  dayKey: DayKey,
  timeZone: string,
): Map<string, TileGeometry> {
  const placements = layOutSpans(spansOf(bookings, dayKey, timeZone))
  const geometry = new Map<string, TileGeometry>()

  for (const placement of placements) {
    const frame = frameOf(placement)
    const height = Math.max(placement.end - placement.start, MINIMUM_TILE_MINUTES)

    geometry.set(placement.key, {
      top: remOf(placement.start),
      height: remOf(height),
      left: frame.left,
      width: frame.width,
    })
  }
  return geometry
}

/**
 * The shaded band behind a day: when this business has anybody working.
 *
 * From the union hull of the active staff's working hours (backend D5), which is
 * why one band and not one per person — it is "the business is open", not "this
 * colleague is in". **The grid still scrolls the whole day either side of it**,
 * because a booking taken before a policy change can sit outside today's hours
 * and a grid cropped to the hull would simply not show it.
 *
 * A day with no row is a day the business is closed, which renders as no band at
 * all rather than as a band of zero height.
 */
export function openBandOf(
  dayKey: DayKey,
  openingHours: readonly OpeningHours[] | undefined,
  timeZone: string,
  scale: GridScale,
): { top: string; height: string } | undefined {
  const weekday = weekdayOf(dayKey)
  const row = openingHours?.find((hours) => hours.dayOfWeek === weekday)
  if (!row) return undefined

  const from = localTimeMinutesIntoDay(dayKey, row.opensAt, timeZone)
  // `closesNextDay` is a real flag on a real shift — a salon closing at 02:00 is
  // open past midnight — so the band runs to the bottom of this column rather
  // than wrapping to a negative height.
  const to = row.closesNextDay
    ? dayLengthMinutes(dayKey, timeZone)
    : localTimeMinutesIntoDay(dayKey, row.closesAt, timeZone)

  if (to <= from) return undefined
  return { top: remOf(from), height: remOf(Math.min(to, scale.minutes) - from) }
}
