package com.slotflow.business;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * {@code PUT /api/business}: the settings a business can change about itself.
 *
 * <p><b>The slug is not here.</b> It is the public URL segment and it is immutable: a booking page
 * whose address changes breaks every link the business has ever sent a customer, and there is no
 * redirect to soften it. {@code Business} has no setter for it either, so this is a constraint rather
 * than an omission.
 *
 * @param timezone     an IANA region id, validated in the service because "well-formed but unknown"
 *                     is not something {@code @Pattern} can decide (see {@link BusinessFields})
 * @param currency     ISO 4217. Changing it reinterprets every price already in the catalog rather
 *                     than converting it — prices are minor units with no currency of their own —
 *                     which is the honest v1 behaviour for a setting nobody changes twice
 * @param confirmShift required, and only for a timezone change: working hours are wall-clock times
 *                     read in this zone, so moving it moves every future slot the engine computes.
 *                     Without the flag the answer is
 *                     {@code 409 TIMEZONE_SHIFT_UNCONFIRMED} carrying the number of future bookings
 *                     involved, so the decision is made by somebody who has seen the number. Ignored
 *                     on every other kind of update
 */
public record BusinessRequest(

        @NotBlank @Size(max = 120)
        @Schema(example = "Dana Clinic")
        String name,

        @NotBlank @Size(max = 64)
        @Schema(example = "Europe/Paris")
        String timezone,

        @NotBlank
        @Pattern(regexp = "^[A-Za-z]{3}$", message = "must be a three-letter ISO 4217 code")
        @Schema(example = "EUR")
        String currency,

        @NotNull
        Boolean depositRequired,

        @NotNull @Min(0) @Max(100)
        @Schema(example = "30")
        Integer depositPercent,

        @Schema(description = "Required only when the timezone changes")
        Boolean confirmShift) {

    boolean isShiftConfirmed() {
        return Boolean.TRUE.equals(confirmShift);
    }
}
