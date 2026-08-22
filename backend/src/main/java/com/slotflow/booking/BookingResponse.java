package com.slotflow.booking;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

/**
 * One booking, in full, for the people who run the business.
 *
 * <p>The only response in the API that carries both the guest contact details and the blocked
 * window. Both are here for the same reason: this is the screen where a staff member works out why
 * a slot they expected to see is missing, and rings the customer about it.
 *
 * <ul>
 *   <li><b>{@code blockedFrom}/{@code blockedTo}</b> — what the calendar actually lost, buffers
 *       included (D4). The customer never sees these; the person whose day they came out of has
 *       to.</li>
 *   <li><b>{@code priceCents} and the buffers</b> are the snapshot taken when the booking was made
 *       (D14), not today's service configuration. A price that changed last week does not rewrite
 *       what this customer agreed, and this response is where that becomes visible.</li>
 *   <li><b>{@code outstandingCents}</b> — what is still owed at the appointment, given whatever the
 *       deposit already covered. Derived rather than stored, and derived here rather than in the
 *       client so that "price minus deposit" has one definition.</li>
 * </ul>
 *
 * <p>No {@code cancellationToken}. Staff have every power over this booking through their own
 * endpoints, so the token would buy them nothing they cannot already do — and it is the customer's
 * credential, printed in a list on a screen in a shop.
 */
public record BookingResponse(
        UUID id,
        UUID serviceId,
        UUID staffId,

        GuestContactResponse guest,

        @Schema(example = "2026-03-04T08:00:00Z") Instant startsAt,
        @Schema(example = "2026-03-04T09:00:00Z") Instant endsAt,
        Instant blockedFrom,
        Instant blockedTo,

        BookingStatus status,
        long priceCents,
        long depositPaidCents,
        long outstandingCents,
        int bufferBeforeMinutes,
        int bufferAfterMinutes,

        String notes,
        Instant expiresAt,
        Instant createdAt,
        Instant updatedAt) {

    static BookingResponse of(Booking booking) {
        return new BookingResponse(
                booking.getId(), booking.getServiceId(), booking.getStaffId(),
                GuestContactResponse.of(booking),
                booking.getStartsAt(), booking.getEndsAt(),
                booking.getBlockedFrom(), booking.getBlockedTo(),
                booking.getStatus(), booking.getPriceCents(), booking.getDepositPaidCents(),
                booking.outstandingCents(),
                booking.getBufferBeforeMinutes(), booking.getBufferAfterMinutes(),
                booking.getNotes(), booking.getExpiresAt(),
                booking.getCreatedAt(), booking.getUpdatedAt());
    }
}
