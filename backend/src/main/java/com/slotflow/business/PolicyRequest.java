package com.slotflow.business;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

/**
 * {@code PUT /api/policy}: the four numbers that decide which slots a customer may pick.
 *
 * <p>A full replace rather than a patch, because the four are read together on every availability
 * request and edited together on one settings form — there is no screen that changes the lead time
 * without the operator seeing the cutoff next to it.
 *
 * <p>Every bound here is narrower than the database's. The check constraints exist so no writer can
 * store nonsense at all; these exist so a person gets told which field they got wrong, in a body a
 * form can attach to an input. Where the two disagree, this one is the product decision and the
 * constraint is the floor.
 *
 * @param minLeadTimeHours        how soon before an appointment a customer may still book it. Zero is
 *                                legal and means "up to the last minute"; a week is the ceiling,
 *                                because a business that needs more notice than that is not taking
 *                                online bookings
 * @param maxAdvanceDays          how far ahead the calendar is open. At least a day, at most a year
 * @param cancellationCutoffHours how long before the start a customer may still cancel. Staff ignore
 *                                it (plan 10)
 * @param slotGranularityMinutes  the step between offered start times. See {@link SlotGranularity},
 *                                and note it is <em>not</em> a rule about service durations
 */
public record PolicyRequest(

        @NotNull @Min(0) @Max(168)
        @Schema(example = "2") Integer minLeadTimeHours,

        @NotNull @Min(1) @Max(365)
        @Schema(example = "60") Integer maxAdvanceDays,

        @NotNull @Min(0) @Max(168)
        @Schema(example = "24") Integer cancellationCutoffHours,

        @NotNull @SlotGranularity
        @Schema(example = "15", allowableValues = {
                "5", "10", "15", "20", "30", "60" }) Integer slotGranularityMinutes) {
}
