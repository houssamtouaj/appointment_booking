package com.slotflow.dashboard;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.time.LocalDate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The screen a business opens every morning.
 *
 * <h2>One endpoint, two answers</h2>
 * An owner sees the whole business; a staff member sees only their own bookings. There is no
 * {@code staffId} parameter — the scoping comes from the token's role, so a staff member cannot ask
 * for a colleague's figures by editing a URL. That difference is visible in the demo, which is why
 * it is spelled out in the operation description rather than left as a surprise.
 *
 * <p>No {@code @PreAuthorize}: every authenticated user of a tenant may see their own dashboard,
 * and the role decides what "their own" means rather than whether they get an answer at all.
 */
@RestController
@Tag(name = "Dashboard", description = "Aggregate figures for the admin dashboard")
public class DashboardController {

    private final DashboardService dashboard;

    public DashboardController(DashboardService dashboard) {
        this.dashboard = dashboard;
    }

    @GetMapping("/api/dashboard/stats")
    @Operation(summary = "Dashboard figures",
            description = """
                    Every number, defined:

                    * todayBookings — CONFIRMED appointments starting today in the business \
                    timezone. Not affected by from/to.
                    * weekBookings — CONFIRMED + COMPLETED in range. Cancelled bookings never count.
                    * revenueCents — sum of price_cents for COMPLETED in range: earned, not booked. \
                    A confirmed appointment next week is not in this number.
                    * depositsCents — sum of deposit_paid_cents for everything not cancelled in \
                    range: money that has arrived, including on appointments still to come.
                    * noShowRate — NO_SHOW / (COMPLETED + NO_SHOW) in range, to four decimal \
                    places. **null**, not 0, when nothing has finished yet, so the UI can say "not \
                    enough data" instead of showing a perfect record nobody earned.
                    * upcoming — the next five CONFIRMED appointments from now, ascending. Not \
                    affected by from/to.

                    An OWNER sees the whole business. A STAFF token sees only its own bookings, in \
                    every figure — the same URL returns different numbers per login, by design.

                    from and to are days, both inclusive, read in the business timezone: the range \
                    runs to midnight following `to`. Exactly the convention the availability \
                    endpoint uses, so the two never disagree about what "this week" covers.""")
    public DashboardStatsResponse stats(
            @Parameter(description = "First day, inclusive. Defaults to the start of the current "
                    + "week (Monday) in the business timezone", example = "2026-03-02")
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,

            @Parameter(description = "Last day, inclusive. Defaults to the end of the current week",
                    example = "2026-03-08")
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,

            @Parameter(description = "IANA zone deciding where the days begin and end. Defaults to "
                    + "the business's own timezone, and frames day boundaries only",
                    example = "Europe/Paris")
            @RequestParam(required = false) String tz) {
        return dashboard.stats(from, to, tz);
    }
}
