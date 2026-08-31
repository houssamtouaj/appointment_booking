import { z } from 'zod'

import { localDate, localTime, uuid } from '@/api/schemas/common'
import { dayOfWeekSchema } from '@/api/schemas/public'

/**
 * Everything the availability engine reads and screen 8 edits: the weekly
 * template, and the one-off overrides that bend it.
 *
 * Two shapes of time live here and neither is an instant. A working-hours range
 * is a wall clock with no date; an override is a date with an optional wall
 * clock on it. Both are interpreted in the **business** timezone, and that is
 * the whole reason "we open at nine" survives a DST change — see
 * `WorkingHours`'s javadoc, which says it at more length. Nothing in this file
 * may be pushed through `date-fns-tz`.
 */

// ---------------------------------------------------------------------------
//  Working hours
// ---------------------------------------------------------------------------

/**
 * One row of the weekly grid, in **both** directions — the response and the
 * request use the same record on the server too.
 *
 * There is no id, and that is the point rather than an omission: publishing one
 * would invite a client to patch a single row, which is the synchronisation
 * problem the full-replace `PUT` exists to avoid. The ids change on every save
 * anyway.
 *
 * `endTime` earlier than `startTime` is a **night shift** and is legal —
 * 22:00–02:00 is a real range. Only `endTime === startTime` is meaningless, and
 * both the entity and the request validator refuse it.
 */
export const workingHoursRangeSchema = z.object({
  /** `MONDAY`…`SUNDAY`. Not the brief's 0–6 — backend D16 explains why. */
  dayOfWeek: dayOfWeekSchema,
  startTime: localTime,
  endTime: localTime,
})

export type WorkingHoursRange = z.infer<typeof workingHoursRangeSchema>

/**
 * `GET /api/staff/{staffId}/working-hours`.
 *
 * Ordered Monday first and then by start time, so a split shift arrives in the
 * order it is worked and the grid draws itself. `staffId` is echoed back because
 * a template with no owner on it is one mix-up away from being shown against the
 * wrong name.
 */
export const workingHoursSchema = z.object({
  staffId: uuid,
  ranges: z.array(workingHoursRangeSchema),
})

export type WorkingHours = z.infer<typeof workingHoursSchema>

/**
 * `PUT /api/staff/{staffId}/working-hours` — **the whole week, every time.**
 *
 * A day absent from `ranges` is a day not worked, not a day left alone: there is
 * nothing to leave it alone with, because the server deletes the template and
 * writes this one inside a single transaction. `{ ranges: [] }` is a legal and
 * meaningful body meaning "no fixed hours", which is why the member is required
 * rather than optional — clearing the week has to be something a client *says*
 * instead of something it forgets to send.
 *
 * The screen owes the reader that sentence before the button is pressed, and
 * `features/hours` writes it in three places. This is the field it is about.
 *
 * `@Size(max = 70)` server-side: ten shifts a day is already absurd, and the cap
 * is what stops one request inserting an unbounded number of rows.
 */
export const workingHoursRequestSchema = z.object({
  ranges: z.array(workingHoursRangeSchema).max(70),
})

export type WorkingHoursRequest = z.infer<typeof workingHoursRequestSchema>

// ---------------------------------------------------------------------------
//  Overrides — `exceptions` on the wire
// ---------------------------------------------------------------------------

/**
 * `BLOCKED` takes availability away; `EXTRA` adds it outside the weekly
 * template.
 *
 * Opposite operations, and the screen renders them as two visually distinct
 * things rather than two labels on one chip: "closed for Christmas" and "open
 * late on Thursday" have nothing in common but a date.
 *
 * `BLOCKED` always wins where the two meet — the engine's rule, not a client
 * one — so an `EXTRA` cannot open a business-wide closure.
 */
export const overrideTypeSchema = z.enum(['BLOCKED', 'EXTRA'])

export type OverrideType = z.infer<typeof overrideTypeSchema>

/**
 * `GET /api/exceptions?from=&to=` — one merged list, both levels in it.
 *
 * **`from` and `to` are required.** A month view that mounts before its range is
 * computed sends neither and gets a 400, which is a watch-out in the wave plan
 * because it is the easy mistake here.
 *
 * `businessWide` and `wholeDay` restate what an absent `staffId` and an absent
 * `startTime` already imply, and the API sends them on purpose: the null-omitting
 * convention means both facts otherwise reach a client as a *missing key*, and
 * inferring meaning from a missing key breaks the first time a serialisation
 * setting changes. Both drive what the panel draws, so both are read from the
 * member that says them out loud.
 */
export const overrideSchema = z.object({
  id: uuid,
  /** Absent on a business-wide closure, which belongs to nobody (backend D5). */
  staffId: uuid.optional(),
  businessWide: z.boolean(),
  date: localDate,
  /** Both absent together, or both present. `wholeDay` is the same fact. */
  startTime: localTime.optional(),
  endTime: localTime.optional(),
  wholeDay: z.boolean(),
  type: overrideTypeSchema,
  /** Free text, `@Size(max = 200)`, never shown to a customer. */
  reason: z.string().optional(),
})

export type Override = z.infer<typeof overrideSchema>

export const overrideListSchema = z.array(overrideSchema)

/**
 * `POST /api/staff/{staffId}/exceptions` and `POST /api/exceptions`.
 *
 * **No `staffId` member, and there must never be one.** The path decides who the
 * override applies to; a field here would be a second, contradictable source of
 * the same fact — and the one a caller could point at somebody else.
 *
 * Three shapes of time are refused server-side with a 422 naming the field, and
 * the form makes two of them unreachable rather than relying on that:
 *
 * - one of `startTime`/`endTime` without the other is a bug rather than a
 *   meaning, so the form has a whole-day toggle instead of two clearable inputs;
 * - `endTime === startTime` says nothing;
 * - a whole-day `EXTRA` is "available, from no time until no time", so the form
 *   does not offer the combination at all.
 */
export const overrideRequestSchema = z.object({
  date: localDate,
  /** Omit **both** for a whole day. A whole-day `BLOCKED` is "closed". */
  startTime: localTime.optional(),
  endTime: localTime.optional(),
  type: overrideTypeSchema,
  reason: z.string().max(200).optional(),
})

export type OverrideRequest = z.infer<typeof overrideRequestSchema>
