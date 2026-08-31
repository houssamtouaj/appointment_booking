import { z } from 'zod'

import { currencyCode, isoInstant, localTime, uuid, zoneId } from '@/api/schemas/common'

/**
 * The four public endpoints — everything a stranger sees before they have an
 * account.
 *
 * Parsed like everything else (F4). These payloads are the largest the app
 * handles: a week of availability on the demo is 163 slots, and parsing that is
 * still well under a millisecond, which is the answer to the only objection.
 *
 * A note on optionality that applies to every schema here. springdoc marks
 * nothing `required` on these responses, so the document cannot be used to tell
 * an always-present field from a sometimes-absent one. What decides it is the
 * overview's null rule — **the API omits nulls rather than sending them** — so a
 * field is `.optional()` here exactly when the backing column is nullable, and
 * required otherwise. Getting that backwards in the lenient direction is cheap
 * (an `undefined` check that never fires); getting it backwards in the strict
 * direction blacks out a tenant's page.
 */

/** `java.time.DayOfWeek`, as Jackson writes it. Monday-first, which is the order the API sends. */
export const dayOfWeekSchema = z.enum([
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
])

export type DayOfWeek = z.infer<typeof dayOfWeekSchema>

/**
 * One opening-hours row.
 *
 * `openingHours` is the **union hull of the active staff's working hours**
 * (backend D5), not a field a business edits: one row per day the business has
 * anybody working. A day with no row is closed, and the table renders it as
 * "Closed" rather than as a gap — six rows arrive for the demo and seven days
 * have to be shown.
 *
 * `closesNextDay` is a real flag on a real shift, not a rounding artefact: a
 * salon closing at 02:00 is open past midnight, and a naive `closesAt <
 * opensAt` check would render that as a negative day.
 */
export const openingHoursSchema = z.object({
  dayOfWeek: dayOfWeekSchema,
  opensAt: localTime,
  closesAt: localTime,
  closesNextDay: z.boolean(),
})

export type OpeningHours = z.infer<typeof openingHoursSchema>

/**
 * A bookable service, as the public sees it.
 *
 * No `active` flag and no `bufferMinutes`: this endpoint returns the active
 * catalogue and nothing else, and the buffer is the engine's business. A service
 * can be deactivated between this payload and a booking attempt, which surfaces
 * as `422 SERVICE_INACTIVE` in wave 4 — deliberately not prevented here with a
 * staleness check the server would have to re-run anyway.
 */
export const publicServiceSchema = z.object({
  id: uuid,
  name: z.string(),
  /** Nullable on `ServiceOffering`, so genuinely absent on a service without one. */
  description: z.string().optional(),
  durationMinutes: z.number().int().positive(),
  /**
   * Minor units, `long`. Never divided by 100 at a call site — `lib/money.ts`
   * divides by the currency's own fraction digits, which is not always two.
   */
  priceCents: z.number().int().nonnegative(),
})

export type PublicService = z.infer<typeof publicServiceSchema>

/**
 * `GET /api/public/businesses/{slug}` — the landing page's single round trip.
 *
 * It carries the catalogue, which is why the landing page does not also call
 * `.../services`: the two return the same shape and the wrapper endpoint exists
 * for consumers that want the catalogue alone.
 *
 * `depositRequired` here is the **raw business setting, not the effective one**
 * (F5). `PublicBusinessService` maps `business.requiresDeposit()` directly,
 * while only `PublicBookingService` ANDs it with `payments.enabled()` — so the
 * demo reports `true` on this payload and then confirms every booking with no
 * deposit taken. Copy driven by this field may say a deposit *may* be requested;
 * it may not say one *is* required. The landing page's wording is a gate item.
 */
export const publicBusinessSchema = z.object({
  slug: z.string(),
  name: z.string(),
  timezone: zoneId,
  currency: currencyCode,
  depositRequired: z.boolean(),
  /** Absent when the business takes no deposit — nullable `Integer` on `Business`. */
  depositPercent: z.number().int().min(0).max(100).optional(),
  openingHours: z.array(openingHoursSchema),
  services: z.array(publicServiceSchema),
})

export type PublicBusiness = z.infer<typeof publicBusinessSchema>

/**
 * `GET .../staff?serviceId=` — `id` and `displayName`, and nothing else.
 *
 * No email and no role, deliberately: this is an unauthenticated endpoint and
 * the roster of a business is not a directory of its staff's contact details.
 * Do not "enrich" this from the admin staff endpoint on a public screen.
 */
export const publicStaffSchema = z.object({
  id: uuid,
  displayName: z.string(),
})

export type PublicStaff = z.infer<typeof publicStaffSchema>

/**
 * One offer from the availability engine.
 *
 * `start` and `end` are UTC instants; the `?tz=` parameter frames which days the
 * server searched and changes nothing about these bytes (backend D11). Every
 * read of a day or an hour off one of these goes through `lib/time.ts`.
 *
 * **`staffIds` is the union of who could take this slot, not an instruction.**
 * When the customer chose "anyone", sending one of these back as `staffId`
 * quietly removes the server's ability to balance the booking across the team —
 * so the flow omits `staffId` entirely instead.
 */
export const slotSchema = z.object({
  start: isoInstant,
  end: isoInstant,
  staffIds: z.array(uuid),
})

export type Slot = z.infer<typeof slotSchema>

export const publicServiceListSchema = z.array(publicServiceSchema)
export const publicStaffListSchema = z.array(publicStaffSchema)
export const slotListSchema = z.array(slotSchema)
