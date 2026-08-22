package com.slotflow.booking;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

/**
 * The one field {@code PATCH /api/bookings/{id}/status} takes.
 *
 * <p>A whole record for one enum, rather than a bare path segment or a query parameter, because the
 * next thing this endpoint grows is a reason or a note and a JSON body is the only shape that can
 * take one without becoming a second endpoint.
 *
 * <p>{@code CONFIRMED} is accepted by the parser and refused by the service (D2). A booking becomes
 * confirmed because a deposit arrived or because it never needed one — never because a staff member
 * pressed a button — and answering {@code 409 ILLEGAL_TRANSITION} says that in the same shape as
 * every other refusal in the matrix. Leaving the value out of the enum entirely would answer
 * {@code 400 MALFORMED_REQUEST} instead, which reads as "no such status" for a status the API
 * returns all day.
 */
public record BookingStatusRequest(

        @NotNull
        @Schema(description = "CANCELLED, COMPLETED or NO_SHOW. CONFIRMED is refused: a deposit "
                + "confirms a booking, staff do not.",
                example = "COMPLETED")
        BookingStatus status) {
}
