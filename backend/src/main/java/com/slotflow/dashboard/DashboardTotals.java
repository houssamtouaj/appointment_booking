package com.slotflow.dashboard;

/**
 * The six numbers one SQL statement produces, as a Spring Data projection.
 *
 * <p>An interface rather than a record because this is the target of a native query: Spring Data
 * hands back a {@code Tuple} and proxies this over it, matching each getter to the query's own
 * column alias. That is why the aliases in {@link DashboardRepository} are double-quoted — Postgres
 * folds unquoted identifiers to lower case, and {@code todaybookings} would not find
 * {@link #getTodayBookings()}.
 *
 * <p><b>Counts, not the rate.</b> The two no-show figures come back separately and
 * {@link DashboardStatsResponse} divides them, because the division has a case SQL cannot express
 * usefully: a business with no completed and no no-show appointments has an undefined rate, not a
 * rate of zero, and {@code NULLIF} in the query would only move that decision somewhere less
 * visible.
 */
public interface DashboardTotals {

    /** {@code CONFIRMED} appointments starting today, in the business timezone. Not range-scoped. */
    long getTodayBookings();

    /** {@code CONFIRMED} + {@code COMPLETED} in range. Cancelled bookings never count. */
    long getWeekBookings();

    /** {@code sum(price_cents)} of {@code COMPLETED} in range — earned, not booked. */
    long getRevenueCents();

    /** {@code sum(deposit_paid_cents)} of everything not cancelled in range — money that arrived. */
    long getDepositsCents();

    long getCompletedCount();

    long getNoShowCount();
}
