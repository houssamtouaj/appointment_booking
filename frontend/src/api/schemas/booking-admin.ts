import { z } from 'zod'

import { bookingStatusSchema, guestContactSchema } from '@/api/schemas/booking'
import { isoInstant, uuid } from '@/api/schemas/common'
import { bookingSummarySchema } from '@/api/schemas/dashboard'
import { pageResponse } from '@/api/schemas/page'

/**
 * The calendar's three endpoints, from inside the business: the paged list, one
 * booking in full, and the one write.
 *
 * Separate from `schemas/booking.ts`, which is the *public* half — the shapes a
 * customer's own booking arrives in behind a cancellation token. They share a
 * status enum and a guest contact and nothing else, and the difference between
 * them is the one worth keeping visible: `PublicBookingResponse` carries a
 * `cancellationToken` and no buffers, this one carries buffers and deliberately
 * no token (backend: "it is the customer's credential, printed in a list on a
 * screen in a shop").
 */

/** `PageResponseBookingSummaryResponse` — the name springdoc publishes; see `page.ts`. */
export const bookingPageSchema = pageResponse(bookingSummarySchema)

export type BookingPage = z.infer<typeof bookingPageSchema>

/**
 * `BookingResponse` — the only shape in the API carrying both a guest's contact
 * details and what the appointment actually cost the calendar.
 *
 * **`blockedFrom`/`blockedTo` are here and nowhere else, and that is why the
 * grid never draws them.** `BookingSummaryResponse` has no such fields, so a
 * week grid drawn from the list has no honest way to show a buffer — and
 * deriving one from the service's *current* buffers would be worse than
 * omitting it, because a booking snapshots its terms at creation (backend D14).
 * A service re-buffered last week would render a band that disagrees with the
 * constraint the database is actually enforcing, on the screen a person uses to
 * work out why a slot is missing. So: the appointment on the grid, the blocked
 * range in the sheet, and the sheet says which is which.
 *
 * `bufferBeforeMinutes` and `bufferAfterMinutes` are the snapshot too, which is
 * what lets the sheet name the numbers rather than just showing two instants.
 */
export const bookingDetailSchema = z.object({
  id: uuid,
  serviceId: uuid,
  /** Always assigned — the engine picks somebody even when the customer did not. */
  staffId: uuid,

  /**
   * Required, unlike its optional twin on `PublicBookingResponse`. There it is
   * genuinely absent from the creation response; here `GuestContactResponse.of`
   * runs on every booking, and a booking without a guest is not a thing this API
   * can produce.
   */
  guest: guestContactSchema,

  startsAt: isoInstant,
  endsAt: isoInstant,
  /** The appointment **plus its buffers** — what the calendar actually lost (D4). */
  blockedFrom: isoInstant,
  blockedTo: isoInstant,

  status: bookingStatusSchema,

  /** The price agreed **when the booking was made**, not today's (D14). */
  priceCents: z.number().int().nonnegative(),
  depositPaidCents: z.number().int().nonnegative(),
  /**
   * Derived server-side rather than here, so that "price minus deposit" has one
   * definition. Subtracting the two on this side would be a second one, and the
   * two would agree until the day a refund or a discount lands between them.
   */
  outstandingCents: z.number().int().nonnegative(),

  bufferBeforeMinutes: z.number().int().nonnegative(),
  bufferAfterMinutes: z.number().int().nonnegative(),

  /** Nullable column — genuinely absent when the customer wrote nothing. */
  notes: z.string().optional(),
  /** Only on a `PENDING` hold; there is nothing in flight to time out otherwise. */
  expiresAt: isoInstant.optional(),

  createdAt: isoInstant,
  updatedAt: isoInstant,
})

export type BookingDetail = z.infer<typeof bookingDetailSchema>

/**
 * `BookingStatusRequest` — the one field the `PATCH` takes.
 *
 * The enum is the **full** `BookingStatus`, not the three a button offers, and
 * that is the backend's design rather than an oversight here: `CONFIRMED` and
 * `PENDING` are parsed and then refused by the service with `409
 * ILLEGAL_TRANSITION`, because "a deposit confirms a booking, staff do not" (D2)
 * is an answer about the lifecycle, while a `400` about an unknown value would
 * be a lie about a status the API returns all day. Narrowing the schema here
 * would move that refusal client-side, which rule 1 forbids — the client holds
 * no domain rules.
 *
 * Which three the calendar actually offers is {@link STAFF_TRANSITIONS}, and
 * that is a statement about buttons, not about what the wire accepts.
 */
export const bookingStatusRequestSchema = z.object({
  status: bookingStatusSchema,
})

export type BookingStatusRequest = z.infer<typeof bookingStatusRequestSchema>

/**
 * The three moves a person can make, in the order the sheet offers them.
 *
 * Not a validation rule and not a copy of the transition matrix — the matrix
 * lives on the backend's `Booking` entity and is enforced there for the sweeper
 * and the Stripe webhook as well as for this endpoint. This is the list of
 * buttons to draw. The server still gets to refuse any of them, and a stale tab
 * will make it do so.
 */
export const STAFF_TRANSITIONS = ['COMPLETED', 'NO_SHOW', 'CANCELLED'] as const

export type StaffTransition = (typeof STAFF_TRANSITIONS)[number]
