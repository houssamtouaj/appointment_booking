package com.slotflow.dashboard;

import com.slotflow.booking.Booking;
import com.slotflow.booking.BookingStatus;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/**
 * The dashboard's two statements. There are no others, and that is the point.
 *
 * <h2>Why the whole thing is one query</h2>
 * The naive shape of this endpoint is five repository calls — count today, count the week, sum
 * revenue, sum deposits, count no-shows — and it returns exactly the same JSON as this does. The
 * difference is five round trips per dashboard load instead of one, on the screen a business opens
 * every morning. Postgres's {@code FILTER} clause computes every aggregate in a single pass over the
 * same rows, which is what makes one statement possible at all.
 *
 * <h2>Why the date arithmetic is in SQL and not in Java</h2>
 * Every boundary here depends on the business's timezone (D11), and reading that timezone in Java
 * would be a third statement — which the gate forbids and, more usefully, which would be a
 * round trip spent on one string. So the query joins {@code business} for the zone and does the
 * conversion itself: {@code timestamptz AT TIME ZONE zone} to get local wall-clock time,
 * {@code date_trunc} to find the boundary, and {@code AT TIME ZONE zone} back again. Postgres's own
 * timezone database is the authority, which is the same one {@code java.time} would have consulted.
 *
 * <p>It is also what lets the range be optional. With the zone available inside the query, "the
 * current week if you did not say" is a {@code CASE} rather than a reason to read a row first.
 *
 * <h2>Every parameter is text</h2>
 * Four of them are nullable, and a null in a native query has no type of its own — Postgres refuses
 * a bare parameter it cannot infer, and Hibernate cannot infer one from a null. Binding everything
 * as text and casting in SQL makes the type explicit at exactly the point Postgres asks for it,
 * rather than depending on which JDBC {@code setNull} overload happened to be chosen.
 */
public interface DashboardRepository extends Repository<Booking, UUID> {

    /**
     * Every figure on the dashboard, in one pass.
     *
     * <p>The join is a {@code LEFT JOIN} from the single bounds row, so a business with no bookings
     * at all still produces a row of zeroes rather than an empty result the caller has to treat as
     * a special case.
     *
     * @param staffId null for an owner, who sees the whole business; the caller's own id for staff,
     *                which is what makes the same endpoint answer differently per login
     * @param zone    an IANA id overriding the business timezone for day boundaries only (D11).
     *                <b>Validated in Java before it gets here</b> — it is interpolated into
     *                {@code AT TIME ZONE}, and an unknown zone would otherwise be a Postgres error
     *                rather than a 422
     * @param from    ISO date, inclusive, or null for the start of the current week
     * @param to      ISO date, <b>inclusive as a day</b> and exclusive as an instant: the range ends
     *                at midnight following it, exactly as the availability endpoint reads its own
     *                {@code to}. The two must never disagree about what "this week" covers
     */
    @Query(nativeQuery = true, value = """
            WITH zone AS (
                SELECT COALESCE(CAST(:zone AS text), b.timezone) AS name
                FROM business b
                WHERE b.id = CAST(:businessId AS uuid)
            ),
            bounds AS (
                SELECT
                    CASE WHEN CAST(:from AS text) IS NULL
                        THEN date_trunc('week', CAST(:now AS timestamptz) AT TIME ZONE z.name)
                             AT TIME ZONE z.name
                        ELSE CAST(CAST(:from AS text) AS date)::timestamp AT TIME ZONE z.name
                    END AS range_from,
                    CASE WHEN CAST(:to AS text) IS NULL
                        THEN (date_trunc('week', CAST(:now AS timestamptz) AT TIME ZONE z.name)
                              + interval '7 days') AT TIME ZONE z.name
                        ELSE (CAST(CAST(:to AS text) AS date) + 1)::timestamp AT TIME ZONE z.name
                    END AS range_to,
                    date_trunc('day', CAST(:now AS timestamptz) AT TIME ZONE z.name)
                        AT TIME ZONE z.name AS day_from,
                    (date_trunc('day', CAST(:now AS timestamptz) AT TIME ZONE z.name)
                     + interval '1 day') AT TIME ZONE z.name AS day_to
                FROM zone z
            )
            SELECT
                count(k.id) FILTER (
                    WHERE k.status = 'CONFIRMED'
                      AND k.starts_at >= x.day_from AND k.starts_at < x.day_to
                ) AS "todayBookings",
                count(k.id) FILTER (
                    WHERE k.status IN ('CONFIRMED', 'COMPLETED')
                      AND k.starts_at >= x.range_from AND k.starts_at < x.range_to
                ) AS "weekBookings",
                COALESCE(sum(k.price_cents) FILTER (
                    WHERE k.status = 'COMPLETED'
                      AND k.starts_at >= x.range_from AND k.starts_at < x.range_to
                ), 0) AS "revenueCents",
                COALESCE(sum(k.deposit_paid_cents) FILTER (
                    WHERE k.status <> 'CANCELLED'
                      AND k.starts_at >= x.range_from AND k.starts_at < x.range_to
                ), 0) AS "depositsCents",
                count(k.id) FILTER (
                    WHERE k.status = 'COMPLETED'
                      AND k.starts_at >= x.range_from AND k.starts_at < x.range_to
                ) AS "completedCount",
                count(k.id) FILTER (
                    WHERE k.status = 'NO_SHOW'
                      AND k.starts_at >= x.range_from AND k.starts_at < x.range_to
                ) AS "noShowCount"
            FROM bounds x
            LEFT JOIN booking k
                   ON k.business_id = CAST(:businessId AS uuid)
                  AND (CAST(:staffId AS text) IS NULL
                       OR k.staff_id = CAST(CAST(:staffId AS text) AS uuid))
            """)
    DashboardTotals totals(@Param("businessId") String businessId,
                           @Param("staffId") String staffId,
                           @Param("zone") String zone,
                           @Param("from") String from,
                           @Param("to") String to,
                           @Param("now") String now);

    /**
     * The next few appointments, whatever range the figures above were asked for.
     *
     * <p>Deliberately not range-scoped: "upcoming" answers "what is next", and a dashboard showing
     * last month's report should still say who is walking in this afternoon. {@code CONFIRMED} only,
     * because a {@code PENDING} booking is a hold that may never become an appointment and putting
     * it on a staff member's "next five" would have them expecting somebody who never paid.
     *
     * <p>Two derived methods rather than one with a nullable {@code staffId}, and only ever one of
     * them runs. A JPQL {@code (:staffId is null or ...)} would give the planner one query text for
     * two very different shapes, and needs a cast on the null to tell Postgres what type it is —
     * for a saving of four lines.
     *
     * <p>{@code id} breaks the tie after {@code startsAt}: two staff members genuinely do start
     * appointments at 09:00, and an unordered tie makes "the next five" depend on what the planner
     * felt like returning.
     */
    List<Booking> findTop5ByBusinessIdAndStatusAndStartsAtGreaterThanEqualOrderByStartsAtAscIdAsc(
            UUID businessId, BookingStatus status, Instant from);

    List<Booking>
            findTop5ByBusinessIdAndStaffIdAndStatusAndStartsAtGreaterThanEqualOrderByStartsAtAscIdAsc(
            UUID businessId, UUID staffId, BookingStatus status, Instant from);
}
