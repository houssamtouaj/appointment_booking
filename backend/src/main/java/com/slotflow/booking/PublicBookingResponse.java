package com.slotflow.booking;

import com.slotflow.business.BookingPolicy;
import com.slotflow.business.Business;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

/**
 * A booking as its customer sees it: the confirmation, and the manage page behind the token.
 *
 * <h2>{@code depositRefundable} is always false, and it is a field rather than a footnote (D7)</h2>
 * Refunds are out of scope, so the money is kept whether the customer cancels or not. That has to
 * be disclosed rather than discovered, and disclosed <em>before</em> the click — which means the
 * manage page needs it as data it can render next to the cancel button, not as a sentence in a
 * terms page. It is hard-coded here because there is nothing to compute: no deployment of this
 * version refunds anything.
 *
 * <h2>Guest contact travels only with the token</h2>
 * {@link #guest} is populated by {@link #forToken}, which is reachable only by presenting the
 * cancellation token, and left null by {@link #created}. Jackson is configured {@code NON_NULL}, so
 * on a creation response the member is absent rather than null. The customer typed those details
 * into the request that produced it and gains nothing from being read them back; the field exists
 * for the manage page, where the token is the credential that earns it.
 *
 * @param cancellationToken the customer's only credential. Never reissued, so the manage link in
 *                          their inbox keeps working for the life of the booking
 * @param expiresAt         when a {@code PENDING} hold lapses (D3). Null on a confirmed booking:
 *                          there is nothing in flight to time out
 * @param cancellable       whether {@code DELETE} would succeed right now — the same question
 *                          {@link BookingPolicy#isCancellable} answers, resolved server-side so the
 *                          page does not have to reimplement the cutoff arithmetic
 * @param cancellationDeadline the instant after which it stops being true
 * @param checkoutUrl       Stripe's hosted page for the outstanding deposit. Present on a
 *                          {@code PENDING} booking and absent on every other, which is the same
 *                          thing said twice: nothing is created {@code PENDING} unless a deposit is
 *                          owed, and confirming clears neither the URL nor the need to stop
 *                          offering it — see {@code build} below
 */
public record PublicBookingResponse(
        UUID id,
        UUID serviceId,
        UUID staffId,

        @Schema(example = "2026-03-04T08:00:00Z") Instant startsAt,
        @Schema(example = "2026-03-04T09:00:00Z") Instant endsAt,

        BookingStatus status,
        long priceCents,
        @Schema(example = "EUR") String currency,

        UUID cancellationToken,
        Instant expiresAt,

        @Schema(description = "Always false (D7). The booking page must say so in words.") boolean depositRefundable,

        boolean cancellable,
        Instant cancellationDeadline,

        String checkoutUrl,
        GuestContactResponse guest) {

    /** D7, restated as the constant it is rather than as a parameter nobody would ever vary. */
    private static final boolean DEPOSIT_REFUNDABLE = false;

    /** The {@code 201}. No contact details: see the class note. */
    static PublicBookingResponse created(Booking booking, Business business, BookingPolicy policy,
            Instant now) {
        return build(booking, business, policy, now, null);
    }

    /** The manage page, and the body of a successful cancel. */
    static PublicBookingResponse forToken(Booking booking, Business business, BookingPolicy policy,
            Instant now) {
        return build(booking, business, policy, now, GuestContactResponse.of(booking));
    }

    private static PublicBookingResponse build(Booking booking, Business business,
            BookingPolicy policy, Instant now,
            GuestContactResponse guest) {
        return new PublicBookingResponse(
                booking.getId(), booking.getServiceId(), booking.getStaffId(),
                booking.getStartsAt(), booking.getEndsAt(),
                booking.getStatus(), booking.getPriceCents(),
                business.getCurrency().getCurrencyCode(),
                booking.getCancellationToken(), booking.getExpiresAt(),
                DEPOSIT_REFUNDABLE,
                // Reported for an active booking only. A cancelled one is not "still cancellable
                // for another six hours", and a page that rendered the button from the deadline
                // alone would offer it.
                booking.isActive() && policy.isCancellable(booking.getStartsAt(), now),
                policy.cancellationDeadline(booking.getStartsAt()),
                // Offered only while there is something to pay. The column outlives the payment —
                // it is what the confirmation webhook resolved — and a paid booking still showing a
                // "pay the deposit" button is a customer paying twice.
                booking.getStatus() == BookingStatus.PENDING ? booking.getStripeCheckoutUrl() : null,
                guest);
    }
}
