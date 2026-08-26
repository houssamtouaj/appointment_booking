package com.slotflow.dashboard;

import com.slotflow.booking.Booking;
import com.slotflow.booking.BookingStatus;
import com.slotflow.booking.BookingSummaryResponse;
import com.slotflow.business.BusinessFields;
import com.slotflow.common.error.ApiException;
import com.slotflow.tenant.TenantContext;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Two queries and one division.
 *
 * <h2>Role scoping is the interesting part</h2>
 * An owner sees the business; a staff member sees themselves. Same endpoint, same response shape,
 * and the only difference is whether {@code staffId} is null — which is decided here from the
 * token's role and <b>never</b> from anything the client sends. There is no {@code ?staffId=} on
 * this endpoint on purpose: it would be a way for a staff member to read a colleague's numbers, and
 * an owner who wants one person's figures can filter the bookings list.
 *
 * <p>The tenant comes from the {@code bid} claim as everywhere else, so cross-tenant data cannot
 * appear with or without date parameters — the business id is a bound parameter of both queries
 * rather than a filter applied afterwards.
 *
 * <h2>The range convention, stated once</h2>
 * {@code from} and {@code to} are dates, both inclusive as <em>days</em>, interpreted in the
 * business timezone (or in {@code tz}, which frames day boundaries and nothing else — D11). As
 * instants that is {@code [from 00:00, to+1 00:00)}, which is precisely what the availability
 * endpoint does with its own {@code from}/{@code to}. The two endpoints have to agree about what
 * "this week" covers, and the only way to guarantee that is to pick one convention and say so in
 * both places.
 *
 * <p>They are a pair: both, for a chosen range, or neither, for the current week. One without the
 * other is refused — see {@link #rejectUnusableRange}.
 */
@Service
public class DashboardService {

    private final DashboardRepository dashboard;
    private final TenantContext tenant;
    private final Clock clock;

    public DashboardService(DashboardRepository dashboard, TenantContext tenant, Clock clock) {
        this.dashboard = dashboard;
        this.tenant = tenant;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public DashboardStatsResponse stats(LocalDate from, LocalDate to, String tz) {
        rejectUnusableRange(from, to);
        // Validated here rather than in the query, because it is interpolated into AT TIME ZONE:
        // an unknown zone has to be a 422 naming the field, not a Postgres error surfacing as a 500.
        String zone = tz == null || tz.isBlank() ? null : BusinessFields.timezone(tz, "tz").getId();

        UUID businessId = tenant.businessId();
        // The whole of the role scoping. Null means "the business"; anything else means "this
        // person", and the token decides which.
        UUID staffId = tenant.isOwner() ? null : tenant.userId();
        Instant now = clock.instant();

        DashboardTotals totals = dashboard.totals(businessId.toString(),
                staffId == null ? null : staffId.toString(), zone,
                from == null ? null : from.toString(),
                to == null ? null : to.toString(),
                now.toString());

        return DashboardStatsResponse.of(totals, upcoming(businessId, staffId, now));
    }

    private List<BookingSummaryResponse> upcoming(UUID businessId, UUID staffId, Instant now) {
        List<Booking> next = staffId == null
                ? dashboard.findTop5ByBusinessIdAndStatusAndStartsAtGreaterThanEqualOrderByStartsAtAscIdAsc(
                        businessId, BookingStatus.CONFIRMED, now)
                : dashboard.findTop5ByBusinessIdAndStaffIdAndStatusAndStartsAtGreaterThanEqualOrderByStartsAtAscIdAsc(
                        businessId, staffId, BookingStatus.CONFIRMED, now);
        return next.stream().map(BookingSummaryResponse::of).toList();
    }

    /**
     * A range that cannot mean what the caller thinks it means.
     *
     * <p>Two mistakes, refused for the same reason. The query would answer either of them — an
     * empty interval matches nothing, so every figure comes back zero — and that is precisely why
     * neither is allowed: a dashboard full of zeroes reads as "a quiet month", not as "your date
     * pickers are the wrong way round".
     *
     * <ul>
     *   <li><b>Backwards.</b> {@code to} before {@code from}, which is the obvious one.</li>
     *   <li><b>Half a range.</b> One bound without the other. The default is a <em>pair</em> — the
     *       current week's Monday and the following one — and the query fills each bound in
     *       independently, so one supplied bound is silently paired with half of that default:
     *       {@code ?to=2026-02-01} means "from this Monday to last February", an empty interval and
     *       the identical wall of zeroes. Refusing it is also the only answer that does not depend
     *       on the business timezone, which lives in the query rather than out here.</li>
     * </ul>
     */
    private static void rejectUnusableRange(LocalDate from, LocalDate to) {
        if ((from == null) != (to == null)) {
            throw ApiException.invalidField(from == null ? "from" : "to",
                    "must be supplied together with " + (from == null ? "to" : "from"));
        }
        if (from != null && to.isBefore(from)) {
            throw ApiException.invalidField("to", "must not be before from");
        }
    }
}
