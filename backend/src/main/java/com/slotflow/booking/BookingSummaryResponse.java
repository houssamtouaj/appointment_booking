package com.slotflow.booking;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

/**
 * One row of the admin bookings list.
 *
 * <p>What a day view renders and nothing else: who, when, for what, and how it stands. The email
 * address and the phone number are deliberately not here — they belong to
 * {@link BookingResponse} and to the one screen that shows a single booking, so that a leak has one
 * place to happen rather than a page of forty. The name stays: a calendar without names on it is
 * not a calendar.
 */
public record BookingSummaryResponse(
        UUID id,
        UUID serviceId,
        UUID staffId,
        String guestName,

        @Schema(example = "2026-03-04T08:00:00Z") Instant startsAt,
        @Schema(example = "2026-03-04T09:00:00Z") Instant endsAt,

        BookingStatus status,
        long priceCents) {

    static BookingSummaryResponse of(Booking booking) {
        return new BookingSummaryResponse(booking.getId(), booking.getServiceId(),
                booking.getStaffId(), booking.getGuestName(),
                booking.getStartsAt(), booking.getEndsAt(),
                booking.getStatus(), booking.getPriceCents());
    }
}
