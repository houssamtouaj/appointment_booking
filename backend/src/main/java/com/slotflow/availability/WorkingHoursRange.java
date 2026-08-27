package com.slotflow.availability;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import java.time.DayOfWeek;
import java.time.LocalTime;

/**
 * One row of the weekly grid, on the wire in both directions.
 *
 * <p>The same record for the request and the response, which is unusual in this codebase and correct
 * here: a working-hours range has no server-side fields at all. It carries no id — deliberately, and
 * that is the point of {@link WorkingHoursRequest} being a full replace: publishing a row id would
 * invite a client to patch one row, which is the synchronisation problem the endpoint exists to
 * avoid, and the ids change on every save anyway.
 *
 * @param dayOfWeek the {@code java.time} name, not the brief's 0–6 (D16): the brief counts from
 *                  Sunday and {@code DayOfWeek} from Monday, and the name has no off-by-one to get
 *                  wrong in either direction
 * @param startTime wall-clock, interpreted in the <em>business</em> timezone (D11)
 * @param endTime   wall-clock. Earlier than {@code startTime} means the shift crosses midnight,
 *                  which is a night shift and legal; equal to it is meaningless and refused
 */
public record WorkingHoursRange(

        @NotNull
        @Schema(example = "MONDAY") DayOfWeek dayOfWeek,

        @NotNull
        @Schema(example = "09:00", type = "string", format = "partial-time") LocalTime startTime,

        @NotNull
        @Schema(example = "17:00", type = "string", format = "partial-time") LocalTime endTime) {
}
