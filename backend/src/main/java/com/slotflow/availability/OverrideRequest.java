package com.slotflow.availability;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.LocalTime;

/**
 * A one-off change to availability, for one staff member or for the whole business.
 *
 * <p>The path decides who it applies to, not the body: {@code /api/staff/{id}/exceptions} is that
 * person's, {@code /api/exceptions} is everyone's ({@code staff_id IS NULL}, D5). A {@code staffId}
 * field here would be a second, contradictable source of the same fact — and the one a caller could
 * point at somebody else.
 *
 * @param date      the day it applies to, in the business timezone
 * @param startTime omit together with {@code endTime} for a whole day. A {@code BLOCKED} override
 *                  with no times is a day off; an {@code EXTRA} one with no times says nothing at all
 *                  and is refused
 * @param endTime   as above. One of the two present without the other is a bug rather than a meaning,
 *                  and the schema makes it unrepresentable
 * @param type      {@code BLOCKED} takes availability away, {@code EXTRA} adds it outside the weekly
 *                  template. Precedence between them belongs to the engine (plan 09), which is why
 *                  overlapping overrides on one date are allowed here
 * @param reason    shown on the admin calendar. Optional, and never shown to a customer
 */
public record OverrideRequest(

        @NotNull
        @Schema(example = "2026-12-25") LocalDate date,

        @Schema(example = "09:00", type = "string", format = "partial-time") LocalTime startTime,

        @Schema(example = "13:00", type = "string", format = "partial-time") LocalTime endTime,

        @NotNull OverrideType type,

        @Size(max = 200)
        @Schema(example = "Public holiday") String reason) {

    boolean isWholeDay() {
        return startTime == null && endTime == null;
    }
}
