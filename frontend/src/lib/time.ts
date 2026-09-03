import { currentLocale } from '@/i18n'
import type { DayOfWeek, Slot } from '@/types'

/**
 * Every read of a time in this app, in the business's zone (F8).
 *
 * The rule the whole wave rests on: **a slot's day and hour are properties of
 * the business, not of whoever is looking.** The API sends UTC instants and
 * frames nothing else — `?tz=` decides day boundaries server-side and the bytes
 * that come back are still `2026-08-31T23:40:00Z`. So `new Date(iso).getDay()`
 * is the *viewer's* weekday, and using it puts a 01:40 Paris slot under the
 * previous day for a visitor in London. That is the single most likely bug in
 * this wave, and it is why nothing outside this file reads a date part off a
 * slot.
 *
 * **Why `formatInTimeZone` rather than `toZonedTime` for every read.** The wave
 * plan says to route reads through `toZonedTime`, and that function does work —
 * but it works by returning a `Date` in the *system* zone whose local getters
 * happen to spell the target wall clock. When the system zone has a DST gap at
 * that wall time, the reconstruction has no instant to land on and comes back an
 * hour out. The bug is invisible in Paris, reproducible in Santiago, and would
 * land on exactly the DST week this wave's gate asks to be tested. Formatting
 * straight out of the target zone never builds that intermediate `Date`, so the
 * system zone cannot participate in the answer. Recorded as a deviation in the
 * wave's decisions; the spirit of the instruction — never read a slot through
 * the viewer's zone — is what this whole file enforces.
 *
 * **The `locale` parameters default to the app's language, not the browser's**
 * (F23). Around thirty call sites pass no locale; before wave 10 they inherited
 * `navigator.language`, which is the wrong answer the moment somebody chooses a
 * language. Threading a locale through thirty call sites would have created a
 * thirty-first that forgot, so the default moved instead. `i18n/language.ts`
 * imports nothing, which is what keeps this direction acyclic.
 *
 * Note what did *not* change: the `'en-US'` inside `wallClockIn` and the
 * `'en-CA'` day-key formatter are parsing formats, not display formats. They are
 * pinned because the code reads their output, and a locale-dependent parse is a
 * bug in any language.
 */

/**
 * A calendar date, `yyyy-MM-dd`, already resolved in some zone.
 *
 * A distinct name because the type system cannot tell one from an instant, and
 * the difference is the wave. Once a `DayKey` exists it is pure calendar
 * arithmetic — no zone, no offset — which is why the helpers below can work on
 * it in UTC and still be right.
 */
export type DayKey = string

/** The `from`/`to` of one displayed week, as the availability endpoint wants them. */
export type DayRange = { from: DayKey; to: DayKey }

/**
 * The API's cap, and it counts **both ends**. A request built as `from + 62` is
 * 63 days and comes back `422` with `errors[0].field === 'to'` — verified
 * against the running stack rather than read off a javadoc.
 */
export const MAX_RANGE_DAYS = 62

// ---------------------------------------------------------------------------
//  Instant -> the business's wall clock
// ---------------------------------------------------------------------------

/**
 * The zone to actually format in, which is the business's unless this browser
 * has never heard of it.
 *
 * `zoneId` is not validated when the payload is parsed, on the deliberate
 * grounds that the server's tz database and the viewer's can differ by a release
 * and a rename must not black out a tenant. That trade only holds if there is a
 * fallback at the far end, and there is not one anywhere else: `Intl` throws
 * `RangeError: Invalid time zone specified` from inside a render, and the app
 * has no error boundary above these screens, so the unhandled throw is a white
 * page rather than a page with the wrong offset. UTC is the honest degradation —
 * the times are then labelled by {@link zoneAbbreviation}, which degrades with
 * it, so the screen still says which clock it is on.
 *
 * Cached because the probe is a formatter construction, and this is asked once
 * per slot per render.
 */
const resolvedZones = new Map<string, string>()

function usableZone(timeZone: string): string {
  const cached = resolvedZones.get(timeZone)
  if (cached !== undefined) return cached

  let resolved = timeZone
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
  } catch {
    resolved = 'UTC'
  }
  resolvedZones.set(timeZone, resolved)
  return resolved
}

/**
 * One formatter per zone, kept.
 *
 * `Intl.DateTimeFormat` construction is the expensive half of formatting, and
 * this is the hot path: a chip asks for its clock twice and its part of day
 * once, every arrow key re-renders the whole day, and a week is 163 slots. A
 * formatter built per call — which is what `formatInTimeZone` does internally —
 * is a few hundred constructions per keystroke.
 *
 * `formatToParts` rather than a format string, because the fields are read back
 * as numbers and assembled here; and `hourCycle: 'h23'` rather than
 * `hour12: false`, which renders midnight as `24` in some ICU builds.
 */
const wallClockFormatters = new Map<string, Intl.DateTimeFormat>()

function wallClockIn(timeZone: string): Intl.DateTimeFormat {
  const cached = wallClockFormatters.get(timeZone)
  if (cached) return cached

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: usableZone(timeZone),
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  wallClockFormatters.set(timeZone, formatter)
  return formatter
}

type WallClock = { year: string; month: string; day: string; hour: string; minute: string }

/**
 * An instant, spelled out in the business's zone.
 *
 * The one place a UTC instant becomes wall-clock fields, so the system zone
 * cannot participate in the answer anywhere — see this file's header for why
 * that, and not `toZonedTime`, is the rule.
 */
function wallClockOf(instant: string | Date, timeZone: string): WallClock {
  const parts = wallClockIn(timeZone).formatToParts(new Date(instant))
  const fields: WallClock = { year: '', month: '', day: '', hour: '', minute: '' }
  for (const part of parts) {
    if (part.type in fields) fields[part.type as keyof WallClock] = part.value
  }
  return fields
}

/**
 * How far ahead of UTC `timeZone` is at this instant, in milliseconds.
 *
 * **Not `getTimezoneOffset` from `date-fns-tz`, which is wrong near a
 * transition.** Verified rather than suspected: for `America/Santiago` at
 * `2026-09-06T03:00:00Z` it answers −3 hours, while `Intl` — and the tz database
 * — put the local clock at 23:00 on the 5th, which is −4. It reports the
 * post-transition offset for the last hours before the transition, so every
 * instant in that window resolves an hour out. The two days a year that matters
 * are exactly the two days this section exists for.
 *
 * Derived from the same formatter every other read in this file goes through,
 * so there is one source of truth about what a zone is doing and it is the one
 * the browser will also use to render the result. Minute precision is not a
 * limitation: UTC offsets have always been whole minutes, so rounding the
 * instant to the minute before subtracting is exact rather than approximate.
 */
function offsetAtMs(at: number, timeZone: string): number {
  const { year, month, day, hour, minute } = wallClockOf(new Date(at), timeZone)
  const asIfUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  )
  return asIfUtc - Math.floor(at / 60_000) * 60_000
}

/** The calendar day this instant falls on **in `timeZone`**. The grouping key. */
export function dayKeyOf(instant: string | Date, timeZone: string): DayKey {
  const { year, month, day } = wallClockOf(instant, timeZone)
  return `${year}-${month}-${day}`
}

/**
 * `"15:10"`, in `timeZone`.
 *
 * 24-hour, deliberately and everywhere. Slot starts are not aligned to the
 * clock — the engine walks the grid from each opening-hours window, so the demo
 * produces `:05`, `:10` and `:35` starts — and a 12-hour clock spends two extra
 * glyphs per chip on a grid that already has to fit at 375px. It is also what
 * the tabular figures in the body face were chosen for: a column of times only
 * scans if the digits line up.
 */
export function clockOf(instant: string | Date, timeZone: string): string {
  const { hour, minute } = wallClockOf(instant, timeZone)
  return `${hour}:${minute}`
}

/** The hour 0–23 in `timeZone`, never the viewer's. */
export function hourOf(instant: string | Date, timeZone: string): number {
  return Number(wallClockOf(instant, timeZone).hour)
}

// ---------------------------------------------------------------------------
//  Calendar arithmetic on a DayKey — no zones, on purpose
// ---------------------------------------------------------------------------

/**
 * Noon UTC on that calendar date.
 *
 * Noon rather than midnight, and it matters: these `Date`s exist only to be
 * incremented and re-formatted in UTC, and starting at midnight leaves no margin
 * for a rounding difference to push the date backwards. Noon is twelve hours
 * from either edge.
 */
function atUtcNoon(dayKey: DayKey): Date {
  return new Date(`${dayKey}T12:00:00Z`)
}

function toDayKey(date: Date): DayKey {
  return date.toISOString().slice(0, 10)
}

/**
 * Whether `raw` names a calendar date that exists.
 *
 * The shape test alone is not the check it looks like, and neither is
 * `Date.parse`: V8 **rolls an impossible day over** rather than rejecting it, so
 * `2026-02-31T12:00:00Z` parses happily as 3 March and `2026-04-31` as 1 May
 * (verified on Node 22). A `?date=` that survived only those two tests would
 * quietly open the picker on a week nobody asked for. Round-tripping is the real
 * check: a date that formats back to itself is the date that went in.
 */
export function isDayKey(raw: string): raw is DayKey {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false
  const date = atUtcNoon(raw)
  return !Number.isNaN(date.getTime()) && toDayKey(date) === raw
}

/** Calendar-date arithmetic. Safe in UTC because a `DayKey` has already left its zone behind. */
export function addDays(dayKey: DayKey, days: number): DayKey {
  const date = atUtcNoon(dayKey)
  date.setUTCDate(date.getUTCDate() + days)
  return toDayKey(date)
}

/** Whole days from `a` to `b`, signed. */
export function daysBetween(a: DayKey, b: DayKey): number {
  return Math.round((atUtcNoon(b).getTime() - atUtcNoon(a).getTime()) / 86_400_000)
}

/** Today, **where the business is** — which is not today where the viewer is. */
export function todayIn(timeZone: string, now: Date = new Date()): DayKey {
  return dayKeyOf(now, timeZone)
}

/**
 * The Monday on or before `dayKey`, and the Sunday that closes that week.
 *
 * Monday-first because the business's own opening hours arrive `MONDAY`-first
 * from the API, and a week table that started on Sunday would disagree with the
 * payload it renders.
 */
export function weekOf(dayKey: DayKey): DayRange {
  // getUTCDay on a UTC-noon date is the weekday of the calendar date itself.
  const weekday = atUtcNoon(dayKey).getUTCDay()
  const sinceMonday = (weekday + 6) % 7
  const from = addDays(dayKey, -sinceMonday)
  return { from, to: addDays(from, 6) }
}

// ---------------------------------------------------------------------------
//  A calendar day as a scale — the geometry wave 6 positions bookings against
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000

/**
 * The instant a calendar date begins **in the business's zone**.
 *
 * Midnight is not a fixed distance from UTC and, twice a year, is not a moment
 * at all — so this resolves it rather than computing it. Two candidates: the
 * wall clock read with the offset in force the day before, and with the offset
 * in force the day after. Sampling a whole day either side is what guarantees a
 * single transition is bracketed rather than straddled.
 *
 * A candidate is *valid* when reading it back in the zone gives the midnight we
 * asked for, and the three-line decision below is the whole of DST:
 *
 *   - **Ordinary day** — the two candidates are the same instant and it is
 *     valid. The common path, and it costs two offset lookups.
 *   - **Ambiguous midnight** — a zone that falls back at 00:00 lives through
 *     midnight twice, and both candidates are valid. The earlier one is taken:
 *     the day begins the first time its first minute happens, and taking the
 *     later would silently discard the hour between them.
 *   - **No midnight at all** — Santiago springs forward at 00:00, so on one date
 *     a year neither candidate is valid. The later is taken, which is the
 *     transition instant itself: the day starts at 01:00 local, because that is
 *     the first moment that exists on it.
 *
 * `fromZonedTime` from `date-fns-tz` is the obvious alternative and is the same
 * trap `toZonedTime` is (see this file's header): it takes wall-clock fields as
 * a `Date` in the **system** zone, so a viewer whose own zone has a gap at that
 * local time hands it an instant that does not exist and gets an answer an hour
 * out. Arithmetic on offsets never builds that intermediate `Date`, so the
 * viewer's zone cannot participate in the answer.
 */
function zonedWallClockMs(dayKey: DayKey, minutesOfDay: number, timeZone: string): number {
  const zone = usableZone(timeZone)
  const naive = Date.parse(`${dayKey}T00:00:00Z`) + minutesOfDay * 60_000

  const candidates = [
    naive - offsetAtMs(naive - DAY_MS, zone),
    naive - offsetAtMs(naive + DAY_MS, zone),
  ]
  const earlier = Math.min(...candidates)
  const later = Math.max(...candidates)

  // Reads back as the wall clock we asked for.
  const spellsIt = (at: number) => at + offsetAtMs(at, zone) === naive

  if (spellsIt(earlier)) return earlier
  return later
}

/** Midnight, which is the case every caller but the opening hours wants. */
function startOfDayMs(dayKey: DayKey, timeZone: string): number {
  return zonedWallClockMs(dayKey, 0, timeZone)
}

/**
 * A `LocalTime` from the API — `"08:30:00"` — as minutes elapsed since this
 * calendar day began in `timeZone`.
 *
 * Which is what the grid's working-hours shading needs, and is not the same as
 * `8 * 60 + 30`. On the day the clocks go forward, 08:30 is seven and a half
 * hours into a twenty-three hour day, and shading drawn from the wall clock
 * would sit an hour below the appointments it is meant to sit behind. Two days a
 * year, on decoration — but the whole file exists so that "two days a year" is
 * never an argument for getting something wrong.
 *
 * The opening hours are a weekly pattern with no date attached (see
 * `schemas/public.ts`), so the date has to be supplied here; that is the one
 * place a `LocalTime` is allowed to meet a calendar day.
 */
export function localTimeMinutesIntoDay(
  dayKey: DayKey,
  localTime: string,
  timeZone: string,
): number {
  const [hours = '0', minutes = '0'] = localTime.split(':')
  const wallMinutes = Number(hours) * 60 + Number(minutes)
  return (zonedWallClockMs(dayKey, wallMinutes, timeZone) - startOfDayMs(dayKey, timeZone)) / 60_000
}

/** The ISO instant a business day begins at. What `GET /api/bookings?from=` wants. */
export function dayStartInstant(dayKey: DayKey, timeZone: string): string {
  return new Date(startOfDayMs(dayKey, timeZone)).toISOString()
}

/**
 * One displayed week as the two instants `GET /api/bookings` reads.
 *
 * **`to` is exclusive**, and it is the opposite of `GET /api/dashboard/stats`,
 * whose `from`/`to` are dates and both inclusive. Getting the two the same way
 * round is a silently wrong week rather than an error — a day double-counted or
 * a day missing — so both screens convert here, once, at the edge (F8), and
 * neither builds an instant of its own.
 *
 * `to` is the start of the day *after* the range's last day, which is the same
 * moment as the end of the last day and is one fewer thing to get wrong than
 * "23:59:59.999". Two adjacent weeks asked for this way neither overlap nor
 * leave a gap, which is what the backend's own javadoc promises.
 */
export function weekInstants(range: DayRange, timeZone: string): { from: string; to: string } {
  return {
    from: dayStartInstant(range.from, timeZone),
    to: dayStartInstant(addDays(range.to, 1), timeZone),
  }
}

/**
 * How long this calendar date actually is, in minutes.
 *
 * 1440 on 363 days a year, 1380 and 1500 on the other two. The grid's row scale
 * is built from this rather than from `24 * 60`, which is the difference between
 * a DST day that renders correctly and one where every afternoon appointment is
 * an hour out — and being an hour out on a calendar is not a cosmetic bug, it is
 * a person turning up at the wrong time.
 */
export function dayLengthMinutes(dayKey: DayKey, timeZone: string): number {
  const start = startOfDayMs(dayKey, timeZone)
  const end = startOfDayMs(addDays(dayKey, 1), timeZone)
  return Math.round((end - start) / 60_000)
}

/**
 * Minutes **elapsed** since the day began — which is not the same as the wall
 * clock, and the difference is the point.
 *
 * On a spring-forward day 14:00 is 13 hours into the day, and a grid whose rows
 * are elapsed minutes puts it against a row labelled 14:00 because
 * {@link hourMarks} labels its rows the same way. Positioning by wall clock
 * instead would need a 24-hour scale on a 23-hour day, and the hour that does
 * not exist would take an hour of appointments with it.
 *
 * Negative before the day starts and past the length after it ends: a booking
 * can straddle midnight, and the caller clamps rather than this pretending it
 * cannot happen.
 */
export function minutesIntoDay(instant: string | Date, dayKey: DayKey, timeZone: string): number {
  const at = instant instanceof Date ? instant.getTime() : Date.parse(instant)
  return (at - startOfDayMs(dayKey, timeZone)) / 60_000
}

/** One labelled row line: how far down it sits, and what the clock says there. */
export type HourMark = { minutes: number; label: string }

/**
 * The hour lines of one day, walked in elapsed time and labelled from the clock.
 *
 * Which is why a DST day reads correctly rather than merely fitting. Walking
 * elapsed hours through 26 October in Paris produces the labels 00, 01, 02,
 * **02**, 03 — twenty-five rows, and the repeat is not a bug to be smoothed
 * over: 02:30 genuinely happens twice that morning, and an appointment in the
 * second one belongs against the second row. Through 29 March it produces 00,
 * 01, 03, 04 — twenty-three rows, and no row for an hour nobody lived through.
 */
export function hourMarks(dayKey: DayKey, timeZone: string): HourMark[] {
  const start = startOfDayMs(dayKey, timeZone)
  const length = dayLengthMinutes(dayKey, timeZone)
  const marks: HourMark[] = []

  for (let minutes = 0; minutes < length; minutes += 60) {
    marks.push({ minutes, label: clockOf(new Date(start + minutes * 60_000), timeZone) })
  }
  return marks
}

/** The seven days of a week, as `DayKey`s. The columns of the week grid. */
export function daysOfWeek(range: DayRange): DayKey[] {
  const days: DayKey[] = []
  for (let offset = 0; offset <= daysBetween(range.from, range.to); offset += 1) {
    days.push(addDays(range.from, offset))
  }
  return days
}

// ---------------------------------------------------------------------------
//  Grouping — the screen this wave exists for
// ---------------------------------------------------------------------------

export type PartOfDay = 'morning' | 'afternoon' | 'evening'

export const PART_OF_DAY_ORDER: readonly PartOfDay[] = ['morning', 'afternoon', 'evening']

export const PART_OF_DAY_LABEL: Record<PartOfDay, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
}

/** Noon and 17:00 **in the business's zone**, which is where a salon's afternoon actually starts. */
export function partOfDay(instant: string | Date, timeZone: string): PartOfDay {
  const hour = hourOf(instant, timeZone)
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

/** One day of offers, already resolved in the business's zone. */
export type SlotDay = {
  dayKey: DayKey
  slots: Slot[]
}

/**
 * Slots to days, in the business's timezone, ascending.
 *
 * Two behaviours worth naming:
 *
 * **Dedupe by `start`.** The engine already unions — verified on the demo: 163
 * slots over one week, zero repeated starts, and 27 rows carrying two
 * `staffIds`. So this merges nothing today, and is kept anyway, because the
 * alternative if that ever changes is a picker offering a customer the same
 * minute twice with no way to tell the two apart. When it does merge it unions
 * the `staffIds` rather than keeping the first row's: dropping an id would
 * quietly narrow who the server may assign.
 *
 * **Sorted by instant, not by the rendered clock.** They almost always agree.
 * They come apart on the night a zone falls back, where 02:30 happens twice and
 * a string sort interleaves the two hours.
 */
export function groupSlotsByDay(slots: readonly Slot[], timeZone: string): SlotDay[] {
  const byStart = new Map<string, Slot>()

  for (const slot of slots) {
    const existing = byStart.get(slot.start)
    if (!existing) {
      byStart.set(slot.start, slot)
      continue
    }
    byStart.set(slot.start, {
      ...existing,
      staffIds: [...new Set([...existing.staffIds, ...slot.staffIds])],
    })
  }

  const days = new Map<DayKey, Slot[]>()
  for (const slot of byStart.values()) {
    const key = dayKeyOf(slot.start, timeZone)
    const bucket = days.get(key)
    if (bucket) bucket.push(slot)
    else days.set(key, [slot])
  }

  return [...days.entries()]
    .map(([dayKey, daySlots]) => ({
      dayKey,
      slots: daySlots.sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
    }))
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey))
}

/** The morning/afternoon/evening split within one day, empty parts dropped. */
export function splitByPartOfDay(
  slots: readonly Slot[],
  timeZone: string,
): { part: PartOfDay; slots: Slot[] }[] {
  return PART_OF_DAY_ORDER.map((part) => ({
    part,
    slots: slots.filter((slot) => partOfDay(slot.start, timeZone) === part),
  })).filter((group) => group.slots.length > 0)
}

// ---------------------------------------------------------------------------
//  Labels
// ---------------------------------------------------------------------------

/**
 * `"Monday 31 August"`. Formatted in UTC because a `DayKey` is a calendar date
 * that has already been resolved — re-interpreting it in a zone is how a heading
 * ends up one day away from the slots underneath it.
 */
export function formatDayHeading(dayKey: DayKey, locale?: string): string {
  return atUtcNoon(dayKey).toLocaleDateString(locale ?? currentLocale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
}

/** `"31 Aug"` — the compact form, for the week's range and the day tabs. */
export function formatDayShort(dayKey: DayKey, locale?: string): string {
  return atUtcNoon(dayKey).toLocaleDateString(locale ?? currentLocale(), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

/** `"31 Aug – 6 Sep 2026"`, the week the picker is showing. */
export function formatRange(range: DayRange, locale?: string): string {
  const year = atUtcNoon(range.to).getUTCFullYear()
  return `${formatDayShort(range.from, locale)} – ${formatDayShort(range.to, locale)} ${year}`
}

/**
 * `"Europe/Paris"` becomes `"Paris"`.
 *
 * From the id rather than from `Intl`'s `shortGeneric`, which renders
 * `"France Time"` — the country, not the city, and wrong the moment a tenant
 * sits in a zone not named after its country.
 *
 * Through {@link usableZone} like every other read, so a zone this browser
 * cannot resolve says "UTC" here as well as in the abbreviation beside it. A
 * city name lifted from the unusable id would label UTC times with a city whose
 * clock they are not on.
 */
export function zoneCity(timeZone: string): string {
  const zone = usableZone(timeZone)
  const last = zone.split('/').pop() ?? zone
  return last.replace(/_/g, ' ')
}

/**
 * `"CEST"`, or `"GMT+2"` where the viewer's locale has no abbreviation for that
 * zone — which is most pairs, and is fine: both answers tell a person which
 * clock the times are on, and inventing an abbreviation `Intl` declines to give
 * would be worse than an offset.
 */
export function zoneAbbreviation(timeZone: string, at: Date = new Date(), locale?: string): string {
  const zone = usableZone(timeZone)
  const parts = new Intl.DateTimeFormat(locale ?? currentLocale(), {
    timeZone: zone,
    timeZoneName: 'short',
  }).formatToParts(at)
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? zone
}

/** The zone the viewer's device is set to. */
export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * Whether the viewer needs telling which clock these times are on (F8).
 *
 * Compares the **offset**, not the id. A visitor in `Europe/Berlin` reading a
 * Paris salon is on the same clock to the minute, and a banner announcing a
 * difference that does not exist is noise that teaches people to ignore the
 * banner that matters. Compared at the instant being displayed rather than at
 * `now`, because two zones can share an offset today and diverge in the week the
 * picker is showing.
 */
export function zonesAgree(a: string, b: string, at: Date = new Date()): boolean {
  const left = usableZone(a)
  const right = usableZone(b)
  // Through {@link offsetAtMs} rather than `date-fns-tz`, which answers the
  // post-transition offset for the hours before a transition — see that
  // function. Wave 3 used the library version and was right except within a
  // couple of hours of a shift, where the banner it drives would claim two
  // zones agreed when they did not.
  return left === right || offsetAtMs(at.getTime(), left) === offsetAtMs(at.getTime(), right)
}

/**
 * Monday-first, matching the order the API sends opening hours in and the order
 * `weekOf` builds a week in.
 */
export const WEEKDAYS: readonly DayOfWeek[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
]

/** Which weekday a calendar date is. Pure calendar arithmetic — see `atUtcNoon`. */
export function weekdayOf(dayKey: DayKey): DayOfWeek {
  // `% 7` guarantees 0–6 and therefore a hit, which `noUncheckedIndexedAccess`
  // cannot derive from modulo arithmetic. Asserted here rather than handed a
  // fallback weekday, which would be a wrong answer dressed as a safe one.
  return WEEKDAYS[(atUtcNoon(dayKey).getUTCDay() + 6) % 7] as DayOfWeek
}

/** `"Monday"`, for a week table that never shows a date. */
export function formatWeekday(weekday: DayOfWeek, locale?: string): string {
  // 2026-08-31 is a Monday, so its index is the offset into a real week.
  const monday = atUtcNoon('2026-08-31')
  monday.setUTCDate(monday.getUTCDate() + WEEKDAYS.indexOf(weekday))
  return monday.toLocaleDateString(locale ?? currentLocale(), { weekday: 'long', timeZone: 'UTC' })
}

/**
 * `"08:30:00"` becomes `"08:30"`.
 *
 * A `LocalTime` from the API, trimmed for display and never parsed into a
 * `Date`. It is a wall clock with no date attached — the salon opens at 08:30
 * every Monday — and giving it one is how it acquires an offset it never had.
 */
export function formatLocalTime(localTime: string): string {
  return localTime.slice(0, 5)
}

/** `20` becomes `"20 min"`, `60` becomes `"1 hr"`, `90` becomes `"1 hr 30 min"`. */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} min`
  if (rest === 0) return `${hours} hr`
  return `${hours} hr ${rest} min`
}
