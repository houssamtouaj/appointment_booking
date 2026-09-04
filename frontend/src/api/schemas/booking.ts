import { z } from 'zod'

import { currencyCode, isoInstant, uuid } from '@/api/schemas/common'
import type { TKey } from '@/i18n'

/**
 * The three endpoints that turn a slot into a booking and let its customer come
 * back to it: `POST .../bookings`, `GET /api/public/bookings/{token}` and the
 * `DELETE` beside it.
 *
 * The optionality rule is the same one `schemas/public.ts` states at length —
 * **the API omits nulls rather than sending them**, so a member is `.optional()`
 * here exactly when the backing column or the mapping is nullable, and required
 * otherwise. Four members on the response are genuinely absent some of the time
 * and each one is a screen that has to cope: `expiresAt` on anything but a hold,
 * `checkoutUrl` on anything but a `PENDING`, `guest` on the creation response,
 * and `guest.phone` when the customer did not give one.
 */

/**
 * `com.slotflow.booking.BookingStatus`.
 *
 * All five, not the two the happy path produces. A token resolves forever
 * (backend D1: the link in an inbox from three weeks ago still works), so the
 * manage page can be opened on a `COMPLETED` appointment or a `NO_SHOW` months
 * later, and a schema that knew only `PENDING`/`CONFIRMED`/`CANCELLED` would
 * turn that into a parse failure on the one screen the customer has.
 */
export const bookingStatusSchema = z.enum([
  'PENDING',
  'CONFIRMED',
  'CANCELLED',
  'COMPLETED',
  'NO_SHOW',
])

export type BookingStatus = z.infer<typeof bookingStatusSchema>

/** `PENDING` and `CONFIRMED` — the two that still hold the slot (`BookingStatus.isActive`). */
export function isActiveStatus(status: BookingStatus): boolean {
  return status === 'PENDING' || status === 'CONFIRMED'
}

/**
 * `GuestContactResponse` — present only where the cancellation token was
 * presented.
 *
 * It is absent from the `201` by design: the customer typed those details into
 * the request that produced it and gains nothing from being read them back. The
 * manage page is where they earn their place, because the token is the
 * credential that fetched them.
 */
export const guestContactSchema = z.object({
  name: z.string(),
  email: z.string(),
  /** Nullable column, so genuinely absent when the customer gave no number. */
  phone: z.string().optional(),
})

export type GuestContact = z.infer<typeof guestContactSchema>

/**
 * `PublicBookingResponse` — the `201`, the manage page and the body of a
 * successful cancel, all one shape.
 *
 * **The response is what decides whether a deposit is taken (F5), and nothing
 * else is.** `depositRequired` on the landing payload is the raw business
 * setting; only `PublicBookingService` ANDs it with `payments.enabled()`. So the
 * branch after a `201` is on `status` and `checkoutUrl` here, never on anything
 * read earlier.
 */
export const publicBookingSchema = z.object({
  id: uuid,
  serviceId: uuid,
  /** Always assigned — the engine picks somebody even when the customer did not. */
  staffId: uuid,

  startsAt: isoInstant,
  endsAt: isoInstant,

  status: bookingStatusSchema,
  priceCents: z.number().int().nonnegative(),
  currency: currencyCode,

  /** The customer's only credential (backend D1). Never reissued. */
  cancellationToken: uuid,

  /**
   * When a `PENDING` hold lapses (backend D3, thirty minutes).
   *
   * **Absent on a confirmed booking**, because there is nothing in flight to
   * time out — which is precisely the watch-out for this wave: a countdown that
   * assumes it exists renders `NaN` on the common path.
   */
  expiresAt: isoInstant.optional(),

  /**
   * Always `false` (backend D7), and a field rather than a footnote because the
   * page owes the customer those words **before** the click, next to the cancel
   * button.
   */
  depositRefundable: z.boolean(),

  cancellable: z.boolean(),
  cancellationDeadline: isoInstant,

  /**
   * Stripe's hosted page, present on a `PENDING` booking and absent on every
   * other. The column outlives the payment; the API stops offering it the moment
   * the booking confirms, so that a paid booking never shows a pay button.
   */
  checkoutUrl: z.string().optional(),

  /** {@link guestContactSchema} — absent on the creation response. */
  guest: guestContactSchema.optional(),
})

export type PublicBooking = z.infer<typeof publicBookingSchema>

// ---------------------------------------------------------------------------
//  The request — also the details form's resolver, so its messages are read
// ---------------------------------------------------------------------------

/**
 * `BookingRequest`, with the backend's own limits.
 *
 * The lengths are not invented: `@Size(max = 120)` on the name, `320` on the
 * address, `32` on the phone and `2000` on the notes, all on the record. Copying
 * them here puts the message under the field instead of after a round trip that
 * spends a slot's worth of the customer's patience — and, for the address, out
 * of a per-email rate-limit budget (backend D12) that a mistyped retry shares.
 *
 * `startsAt` is **copied verbatim from a slot**, never rebuilt from a local time
 * and a zone: reconstructing a moment from those two on the server is how a
 * booking lands an hour out on the last Sunday in March.
 *
 * `staffId` is omitted entirely for "anyone" rather than filled from a slot's
 * `staffIds` — the same rule the availability request follows, and for the same
 * reason: that array is the union of who *could* take the slot, and sending one
 * back removes the server's ability to balance the work.
 *
 * The messages are **dictionary keys, not sentences**. This module is evaluated
 * once, so a sentence would be captured in whatever language the tab was loaded
 * in and would survive a language switch — and this is the form where that costs
 * most, because a customer on `/b/<slug>` is the reader least likely to be
 * reading English. `DetailsStep` resolves them at the field.
 */
export const bookingRequestSchema = z.object({
  serviceId: uuid,
  staffId: uuid.optional(),
  startsAt: isoInstant,

  guestName: z
    .string()
    .trim()
    .min(1, 'booking.details.nameRequired' satisfies TKey)
    .max(120, 'booking.details.tooLong' satisfies TKey),

  /**
   * `z.email()`, matching the backend's `@Email`.
   *
   * Worth being strict about client-side precisely because the server is: this
   * address is the rate-limiting key, so a customer who mistypes it twice meets
   * a `429` rather than a second chance (F15).
   */
  guestEmail: z
    .string()
    .trim()
    .min(1, 'booking.details.emailRequired' satisfies TKey)
    .max(320, 'booking.details.tooLong' satisfies TKey)
    .pipe(z.email('booking.details.emailShape' satisfies TKey)),

  guestPhone: z
    .string()
    .trim()
    .max(32, 'booking.details.tooLong' satisfies TKey)
    .optional(),
  notes: z
    .string()
    .trim()
    .max(2000, 'booking.details.notesTooLong' satisfies TKey)
    .optional(),
})

export type BookingRequest = z.infer<typeof bookingRequestSchema>

/**
 * The four fields the customer actually types.
 *
 * Picked from the request rather than declared again, so the length limits and
 * the messages have one home. It is a separate schema because it is a separate
 * thing: `serviceId`, `staffId` and `startsAt` are choices already made on three
 * earlier screens and living in the URL, and putting them in the form's shape
 * would mean registering three inputs nobody can see and reconciling them with
 * the query string on every render.
 *
 * It is also what makes the `409` recovery free. The form holds only what was
 * typed, so it can outlive the slot it was going to be submitted with.
 */
export const guestDetailsSchema = bookingRequestSchema.pick({
  guestName: true,
  guestEmail: true,
  guestPhone: true,
  notes: true,
})

export type GuestDetails = z.infer<typeof guestDetailsSchema>
