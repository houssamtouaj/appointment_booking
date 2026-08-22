package com.slotflow.booking;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;

/**
 * What a guest sends to book a slot.
 *
 * <p><b>{@code startsAt} is an instant, copied verbatim from a slot in the availability response.</b>
 * Not a local time plus a zone name: reconstructing a moment from those two on the server is how a
 * booking lands an hour out on the last Sunday in March, and the customer would not find out until
 * they turned up. Every instant this API emits is UTC ISO-8601 and this is the one it reads back.
 *
 * <p>There is no {@code priceCents} here, and there never will be. The price is snapshotted from
 * the service at insert (D14). Accepting an amount from an unauthenticated request body is the most
 * common real vulnerability in booking systems assembled from tutorials.
 *
 * <p>No account either (D1): these three contact fields are the entire identity of the customer,
 * and the {@code cancellationToken} that comes back is their only credential.
 *
 * @param serviceId what is being booked; decides the duration, the price and the buffers
 * @param staffId   a specific person, or null for "anybody" — in which case the server picks the
 *                  candidate with the fewest bookings that day, then the lowest id (plan 09)
 * @param startsAt  the exact start, from the availability response
 * @param notes     anything the customer wants the business to know. Capped because this is an
 *                  anonymous endpoint and {@code text} in Postgres has no length of its own
 */
public record BookingRequest(

        @NotNull UUID serviceId,

        @Schema(description = "Omit for \"anybody who can do this\"")
        UUID staffId,

        @NotNull
        @Schema(example = "2026-03-04T08:00:00Z",
                description = "Copied from a slot's start in the availability response")
        Instant startsAt,

        @NotBlank @Size(max = 120) String guestName,

        // @Email over a hand-rolled regex: this is the address the confirmation, the reminder and
        // the manage link all go to, and it is also the rate-limiting key (D12).
        @NotBlank @Email @Size(max = 320) String guestEmail,

        @Size(max = 32) String guestPhone,

        @Size(max = 2000) String notes) {
}
