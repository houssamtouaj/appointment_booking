package com.slotflow.availability;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * One bookable start time on the wire.
 *
 * <p><b>Instants, always UTC (D11).</b> The {@code ?tz=} parameter decides which days were asked
 * about and nothing else; it never changes what a slot <em>is</em>. A client renders these in
 * whatever zone its user is standing in, and the one thing it must not have to do is reconstruct a
 * moment from a local time plus a zone name it was told separately.
 *
 * <p>No buffers here, deliberately: the customer is booking sixty minutes and the eighty the
 * calendar loses are none of their business (D4). {@code end} is {@code start} plus the service
 * duration, which is what a confirmation email says.
 *
 * @param start    inclusive
 * @param end      exclusive
 * @param staffIds everyone who could serve this slot, sorted and never empty. A named-staff query
 *                 returns lists of one; an any-staff query returns the candidates plan 10 picks
 *                 between when the booking is actually made
 */
public record SlotResponse(

        @Schema(example = "2026-03-02T08:00:00Z") Instant start,

        @Schema(example = "2026-03-02T09:00:00Z") Instant end,

        List<UUID> staffIds) {
}
