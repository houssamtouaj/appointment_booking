package com.slotflow.dashboard;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.slotflow.booking.BookingSummaryResponse;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

/**
 * The admin dashboard, with every number defined.
 *
 * <p>The definitions are the deliverable here as much as the numbers are. "Revenue" is the figure a
 * client asks about first, and <em>booked</em> versus <em>earned</em> is exactly the distinction
 * that decides whether a dashboard is trusted: an appointment that has not happened yet is not
 * money, and an appointment that was cancelled never was.
 *
 * @param todayBookings {@code CONFIRMED} appointments starting today in the business timezone.
 *                      Independent of {@code from}/{@code to} — it is the "what does today look
 *                      like" number, and a report about last month should still answer it
 * @param weekBookings  {@code CONFIRMED} + {@code COMPLETED} in range. Cancelled bookings are
 *                      excluded, so this cannot be inflated by churn
 * @param revenueCents  {@code sum(price_cents)} of {@code COMPLETED} in range: <b>earned</b>, not
 *                      booked. A confirmed appointment next Thursday is not in this number
 * @param depositsCents {@code sum(deposit_paid_cents)} of everything not cancelled in range — money
 *                      that has actually arrived, including on appointments still to come. It is
 *                      deliberately not a subset of {@code revenueCents}: a deposit on a future
 *                      booking is real money against unearned revenue, and a business needs both
 * @param upcoming      the next five {@code CONFIRMED} appointments from now, ascending. Not
 *                      range-scoped
 */
public record DashboardStatsResponse(
        @Schema(example = "12") long todayBookings,
        @Schema(example = "47") long weekBookings,
        @Schema(example = "184500") long revenueCents,
        @Schema(example = "42000") long depositsCents,

        /*
         * NO_SHOW / (COMPLETED + NO_SHOW), or null when nobody has finished an appointment yet.
         *
         * Null and not zero, and the difference is the whole point: a business with no completed
         * appointments has no no-show rate, and rendering that as "0%" tells an owner they have a
         * perfect record when what they have is no data. The UI can only say "not enough data" if
         * the API is willing to say "I do not know".
         *
         * @JsonInclude(ALWAYS) overrides the application-wide NON_NULL, which would otherwise drop
         * the member entirely. A client checking `stats.noShowRate === null` would then see
         * undefined and, in a language where both are falsy, quietly render the zero this field
         * exists to avoid. This is the one field in the API where absent and null are not the same
         * thing, so it is the one field that opts out.
         */
        @JsonInclude(JsonInclude.Include.ALWAYS)
        @Schema(example = "0.043", nullable = true,
                description = "null when there are no completed or no-show appointments in range")
        Double noShowRate,

        List<BookingSummaryResponse> upcoming) {

    /**
     * Four decimal places, half up.
     *
     * <p>A raw {@code double} would serialise as 0.04255319148936170, which is a precision this
     * ratio does not have — it is two integers, and the third one is somebody's rounding. Four
     * places is a tenth of a percentage point, which is finer than any dashboard renders and coarse
     * enough to read.
     */
    private static final int RATE_SCALE = 4;

    static DashboardStatsResponse of(DashboardTotals totals,
                                     List<BookingSummaryResponse> upcoming) {
        return new DashboardStatsResponse(
                totals.getTodayBookings(),
                totals.getWeekBookings(),
                totals.getRevenueCents(),
                totals.getDepositsCents(),
                noShowRate(totals.getNoShowCount(), totals.getCompletedCount()),
                upcoming);
    }

    /** @return null when the denominator is zero — see the field note, not an oversight */
    private static Double noShowRate(long noShows, long completed) {
        long finished = noShows + completed;
        if (finished == 0) {
            return null;
        }
        return BigDecimal.valueOf(noShows)
                .divide(BigDecimal.valueOf(finished), RATE_SCALE, RoundingMode.HALF_UP)
                .doubleValue();
    }
}
