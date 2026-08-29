import { getTimezoneOffset } from 'date-fns-tz'

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
  return atUtcNoon(dayKey).toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
}

/** `"31 Aug"` — the compact form, for the week's range and the day tabs. */
export function formatDayShort(dayKey: DayKey, locale?: string): string {
  return atUtcNoon(dayKey).toLocaleDateString(locale, {
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
  const parts = new Intl.DateTimeFormat(locale, {
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
  return left === right || getTimezoneOffset(left, at) === getTimezoneOffset(right, at)
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
  return monday.toLocaleDateString(locale, { weekday: 'long', timeZone: 'UTC' })
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
