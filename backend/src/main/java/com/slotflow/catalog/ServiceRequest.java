package com.slotflow.catalog;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

/**
 * {@code POST /api/services}: everything a bookable service needs to exist.
 *
 * <p>Two request records rather than one shared with the patch, which plan 07 sketched as a single
 * {@code ServiceRequest}. A create has required fields and a patch has none, and the only ways to
 * express both with one record are validation groups — a second vocabulary to learn for one
 * endpoint — or dropping {@code @NotNull} from the create, which moves the check into the service
 * and turns "name is missing" into a different response shape from every other missing field. The
 * staff endpoints already split the same way ({@code InviteStaffRequest} /
 * {@code UpdateStaffRequest}).
 *
 * @param name                what the customer picks from the list
 * @param description         prose, and optional. The column is {@code text}; the cap here only
 *                            stops a client posting a megabyte into a landing page
 * @param durationMinutes     what the customer is booking. See {@link ServiceDuration} for why the
 *                            grid is five minutes and not the business's slot granularity
 * @param priceCents          minor units, never a decimal. Zero is legal: a free consultation is a
 *                            real thing to offer
 * @param bufferBeforeMinutes setup time the calendar loses and the customer never sees. Absent
 *                            means none
 * @param bufferAfterMinutes  cleanup time after. Absent means none
 * @param staffIds            who performs it. Absent or empty creates the service with nobody
 *                            assigned, which is legal and comes back as {@code bookable: false}
 */
public record ServiceRequest(

        @NotBlank @Size(min = 2, max = 120)
        @Schema(example = "Deep tissue massage")
        String name,

        @Size(max = 2000)
        String description,

        @NotNull @ServiceDuration
        @Schema(example = "60")
        Integer durationMinutes,

        @NotNull @PositiveOrZero
        @Schema(example = "5000", description = "Minor units of the business currency")
        Long priceCents,

        @Min(0) @Max(120)
        @Schema(example = "10")
        Integer bufferBeforeMinutes,

        @Min(0) @Max(120)
        @Schema(example = "10")
        Integer bufferAfterMinutes,

        List<UUID> staffIds) {
}
