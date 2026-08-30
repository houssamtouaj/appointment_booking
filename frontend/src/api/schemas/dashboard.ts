import { z } from 'zod'

import { bookingStatusSchema } from '@/api/schemas/booking'
import { isoInstant, uuid } from '@/api/schemas/common'

/**
 * `GET /api/dashboard/stats`, and the row shape the calendar shares with it.
 *
 * Every figure here is defined by one SQL projection on the server, and the
 * definitions are not obvious — "revenue" in particular means *earned*, not
 * booked. The labels that carry those definitions live in
 * `features/dashboard/figures.ts`; what this file guarantees is that the numbers
 * arrive in the shape those labels claim.
 */

/**
 * `BookingSummaryResponse` — one row of the admin bookings list, and the same
 * shape the dashboard's `upcoming` uses. The backend reuses the record rather
 * than copying it, and the field it is careful *not* to carry is the guest's
 * email address: a day view shows forty of these, and a leak should have one
 * place to happen rather than forty.
 *
 * Note what is here and what is not: `serviceId` and `staffId`, and no names.
 * That absence is the entire argument for F7 — every booking-shaped payload in
 * this API needs the same client-side join, so it is done once in `useLookups()`
 * rather than three times in three caches that drift.
 */
export const bookingSummarySchema = z.object({
  id: uuid,
  serviceId: uuid,
  /** Always assigned — the engine picks somebody even when the customer did not. */
  staffId: uuid,
  guestName: z.string(),
  startsAt: isoInstant,
  endsAt: isoInstant,
  status: bookingStatusSchema,
  priceCents: z.number().int().nonnegative(),
})

export type BookingSummary = z.infer<typeof bookingSummarySchema>

/**
 * `DashboardStatsResponse`.
 *
 * **`noShowRate` is `.nullable()` and not `.optional()`, and the difference is
 * the point.** Every other nullable thing in this API is *omitted* — the app
 * serialises `NON_NULL` — but this one field carries `@JsonInclude(ALWAYS)`
 * specifically so that a client can tell "no data" from "a perfect record". A
 * schema that accepted the member being absent would let a backend regression
 * that dropped the annotation arrive as `undefined`, which is falsy in the same
 * places `null` is and renders as the 0% the backend went out of its way to
 * avoid. Requiring the key is how that regression fails loudly here instead of
 * lying quietly on screen.
 */
export const dashboardStatsSchema = z.object({
  /** `CONFIRMED` starting today in the business timezone. **Not** range-scoped. */
  todayBookings: z.number().int().nonnegative(),
  /** `CONFIRMED` + `COMPLETED` in range. Cancellations never count. */
  weekBookings: z.number().int().nonnegative(),
  /** `SUM(price_cents)` of `COMPLETED` in range: earned, not booked. */
  revenueCents: z.number().int().nonnegative(),
  /** Deposits on everything not cancelled in range — money that has arrived. */
  depositsCents: z.number().int().nonnegative(),
  /** `NO_SHOW / (COMPLETED + NO_SHOW)`, four decimal places, or `null`. */
  noShowRate: z.number().min(0).max(1).nullable(),
  /** The next five `CONFIRMED` from now, ascending. **Not** range-scoped. */
  upcoming: z.array(bookingSummarySchema),
})

export type DashboardStats = z.infer<typeof dashboardStatsSchema>
