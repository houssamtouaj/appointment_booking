package com.slotflow.availability.domain;

import com.slotflow.availability.AvailabilityOverride;
import com.slotflow.availability.WorkingHours;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;

/**
 * The thing this project is about: an {@link AvailabilityQuery} in, the exact set of bookable start
 * times out.
 *
 * <h2>Pure, and deliberately not a {@code @Service}</h2>
 * No Spring, no repository, no {@code Instant.now()} — the policy window arrives on the query as two
 * instants that somebody else computed from the injected {@code Clock}. That is what lets the whole
 * test matrix run in milliseconds against no database, and it is the single decision the plan says
 * makes this ten hours of work instead of twenty-five. Static methods for the same reason
 * {@code OpeningHours.derive} is static: there is no state here to inject, and pretending otherwise
 * would put a mock between the tests and the algorithm they exist to pin down.
 *
 * <h2>The pipeline</h2>
 * Per staff member, over every business-zone date the range touches:
 *
 * <ol>
 *   <li><b>Materialise the weekly template</b> into instants —
 *       {@code ZonedDateTime.of(date, localTime, businessZone)}. A row whose end is before its start
 *       is a night shift and ends on {@code date + 1}.</li>
 *   <li><b>Add every {@code EXTRA} window</b>, then coalesce. Extra hours that touch the template
 *       become one window, so a shift extended by an hour has no seam in the middle of it.</li>
 *   <li><b>Subtract every {@code BLOCKED} window</b>, business-wide (D5) and staff-level alike.</li>
 *   <li><b>Subtract the bookings</b>, using the buffer-expanded {@code [blocked_from, blocked_to)}
 *       already stored on each row (D4) — the same interval the database's exclusion constraint
 *       ranges over, so the engine cannot offer a slot the constraint would then refuse.</li>
 *   <li><b>Walk</b> what is left, in granularity steps from each window's own start.</li>
 *   <li><b>Clamp</b> to the policy window and to the requested range.</li>
 * </ol>
 *
 * <h2>Precedence, decided here: {@code BLOCKED} always beats {@code EXTRA}</h2>
 * Whatever the level, whatever the insertion order. A staff member's {@code EXTRA} evening cannot
 * reopen a business-wide Christmas closure, and it does not matter which row was written first. The
 * rule falls out of the order above rather than being enforced by a special case: every {@code
 * EXTRA} is added before any {@code BLOCKED} is taken away. It is arbitrary — the opposite rule is
 * just as implementable — which is exactly why it is written down here and in the README rather than
 * left to be inferred from behaviour.
 *
 * <h2>Buffers fit inside working hours, they do not spill past the edges</h2>
 * A slot survives only if {@code [start - bufferBefore, start + duration + bufferAfter)} lies wholly
 * inside the open window. With ten minutes of setup, the first appointment of a 09:00 day starts at
 * 09:00 + granularity, not at 09:00 — because setting up at 08:50 means opening at 08:50.
 */
public final class AvailabilityEngine {

    private AvailabilityEngine() {
    }

    /**
     * Every bookable start in the range, ascending, each carrying the staff who could serve it.
     *
     * <p>An any-staff query is the union across candidates deduped by start instant; a named-staff
     * query is the same fold over a list of one. The engine does not know which it was given, which
     * is why there is no second code path to keep in step with the first.
     */
    public static List<Slot> slots(AvailabilityQuery query) {
        if (query.staff().isEmpty()) {
            return List.of();
        }

        List<LocalDate> dates = datesToScan(query.range(), query.businessZone());
        // Sorted by start, so the response is already in the order a calendar renders it. A set per
        // start rather than a list: one staff member can reach the same instant from two windows —
        // a night shift and the next morning's template that touches it — and appearing twice in
        // their own slot's candidate list would make plan 10's "fewest bookings" tie-break wrong.
        Map<Instant, Set<UUID>> byStart = new TreeMap<>();
        for (AvailabilityQuery.StaffSchedule schedule : query.staff()) {
            for (Instant start : startsFor(schedule, dates, query)) {
                byStart.computeIfAbsent(start, ignored -> new LinkedHashSet<>())
                        .add(schedule.staffId());
            }
        }

        List<Slot> slots = new ArrayList<>(byStart.size());
        byStart.forEach((start, staffIds) ->
                slots.add(Slot.of(start, query.durationMinutes(), staffIds)));
        return List.copyOf(slots);
    }

    // ---------------------------------------------------------------------------------
    //  the scanned span — shared with the loader, so the two cannot drift
    // ---------------------------------------------------------------------------------

    /**
     * Every business-zone date whose working hours could reach into the requested range.
     *
     * <p>One date earlier than the range begins, and that is load-bearing twice over: a 22:00–02:00
     * shift started yesterday is still running at 01:00 today, and {@code ?tz=} can put the start of
     * the requested range in the middle of the previous business-zone day. Nothing is needed at the
     * far end for the mirror-image reason — a shift belonging to the day <em>after</em> the last
     * scanned date cannot start before that date's midnight, which is already past the end of the
     * range.
     */
    public static List<LocalDate> datesToScan(TimeWindow range, ZoneId zone) {
        LocalDate first = LocalDate.ofInstant(range.start(), zone).minusDays(1);
        // The range is half-open, so its last instant is the one just before the end. Taking the
        // date of the end itself would scan one spurious day every time the range ends at midnight,
        // which is every time.
        LocalDate last = LocalDate.ofInstant(range.end().minusNanos(1), zone);

        List<LocalDate> dates = new ArrayList<>();
        for (LocalDate date = first; !date.isAfter(last); date = date.plusDays(1)) {
            dates.add(date);
        }
        return List.copyOf(dates);
    }

    /**
     * The instants those dates span, which is the window the caller must load bookings over.
     *
     * <p>Wider than the requested range at both ends, and it has to be: a booking that started
     * yesterday evening blocks this morning, and one starting tonight blocks the last slot of the
     * scanned day. Deriving it here rather than in the service is what stops the loader and the
     * scanner disagreeing about which day the engine is about to look at.
     */
    public static TimeWindow loadWindow(TimeWindow range, ZoneId zone) {
        List<LocalDate> dates = datesToScan(range, zone);
        return new TimeWindow(
                dates.getFirst().atStartOfDay(zone).toInstant(),
                dates.getLast().plusDays(1).atStartOfDay(zone).toInstant());
    }

    // ---------------------------------------------------------------------------------
    //  one staff member
    // ---------------------------------------------------------------------------------

    private static List<Instant> startsFor(AvailabilityQuery.StaffSchedule schedule,
                                           List<LocalDate> dates, AvailabilityQuery query) {
        ZoneId zone = query.businessZone();

        // Steps 1 and 2, over the whole scanned span at once rather than day by day. Coalescing
        // across the date boundary is the point: a 22:00-02:00 shift and the following 02:00-06:00
        // one are six unbroken hours, and walking them as two windows would restart the grid at
        // 02:00 and lose every slot that straddles it.
        List<TimeWindow> open = new ArrayList<>();
        for (LocalDate date : dates) {
            addWorkingWindows(open, schedule.workingHours(), date, zone);
            addOverrideWindows(open, schedule.overrides(), date, zone, OverrideKind.EXTRA);
        }
        if (open.isEmpty()) {
            return List.of();
        }

        // Steps 3 and 4. Business-wide overrides are read for BLOCKED only: the config layer refuses
        // a business-wide EXTRA on the grounds that a business cannot declare somebody else free,
        // and asking for it here would be the engine honouring a row that cannot exist.
        List<TimeWindow> cuts = new ArrayList<>(schedule.busy());
        for (LocalDate date : dates) {
            addOverrideWindows(cuts, query.businessWide(), date, zone, OverrideKind.BLOCKED);
            addOverrideWindows(cuts, schedule.overrides(), date, zone, OverrideKind.BLOCKED);
        }

        List<TimeWindow> bookable =
                TimeWindow.subtractAll(TimeWindow.normalize(open), TimeWindow.normalize(cuts));

        List<Instant> starts = new ArrayList<>();
        for (TimeWindow window : bookable) {
            walk(window, query, starts);
        }
        return starts;
    }

    /**
     * Step 5 and 6: the grid, anchored at the window's own start.
     *
     * <p>Anchored there and not at midnight, which is the plan's rule and worth understanding.
     * A window that begins at 10:20 because a booking ended there offers 10:20 next, not 10:30 —
     * the earliest moment the work can actually begin. The cost is that the afternoon's starts need
     * not line up with the morning's once something has been taken out of the day; the benefit is
     * that no time is thrown away rounding up to a grid the customer cannot see.
     */
    private static void walk(TimeWindow window, AvailabilityQuery query, Collection<Instant> into) {
        long stepSeconds = query.slotGranularityMinutes() * 60L;
        long bufferBeforeSeconds = query.bufferBeforeMinutes() * 60L;
        long blockSeconds = query.totalBlockMinutes() * 60L;

        for (Instant start = window.start(); ; start = start.plusSeconds(stepSeconds)) {
            Instant blockedFrom = start.minusSeconds(bufferBeforeSeconds);
            Instant blockedTo = blockedFrom.plusSeconds(blockSeconds);
            if (blockedTo.isAfter(window.end())) {
                // Every later start is worse, so this window is finished. This is also the exit for
                // a service longer than the window, which is an empty result and not an exception.
                return;
            }
            if (blockedFrom.isBefore(window.start())) {
                // The setup buffer would spill past the edge of the working window. Later starts
                // still might not, so this is a skip and not a stop.
                continue;
            }
            if (start.isBefore(query.earliestStart()) || start.isAfter(query.latestStart())) {
                continue;
            }
            // The requested range decides which starts are reported, not which are computed: a
            // window may legitimately begin before the range and end after it.
            if (query.range().contains(start)) {
                into.add(start);
            }
        }
    }

    // ---------------------------------------------------------------------------------
    //  wall clock to instants
    // ---------------------------------------------------------------------------------

    private static void addWorkingWindows(List<TimeWindow> into, List<WorkingHours> template,
                                          LocalDate date, ZoneId zone) {
        for (WorkingHours row : template) {
            if (row.getDayOfWeek() != date.getDayOfWeek()) {
                continue;
            }
            LocalDate endDate = row.crossesMidnight() ? date.plusDays(1) : date;
            addWindow(into, date, row.getStartTime(), endDate, row.getEndTime(), zone);
        }
    }

    /** Which half of an override list to read. Both halves are needed, at different steps. */
    private enum OverrideKind {
        BLOCKED, EXTRA
    }

    private static void addOverrideWindows(List<TimeWindow> into,
                                           List<AvailabilityOverride> overrides,
                                           LocalDate date, ZoneId zone, OverrideKind kind) {
        for (AvailabilityOverride override : overrides) {
            if (!date.equals(override.getDate())
                    || override.isBlocked() != (kind == OverrideKind.BLOCKED)) {
                continue;
            }
            if (override.isWholeDay()) {
                addWindow(into, date, LocalTime.MIDNIGHT, date.plusDays(1), LocalTime.MIDNIGHT, zone);
                continue;
            }
            // An override may cross midnight for the same reason a shift may — "blocked 22:00 to
            // 02:00" is an ordinary sentence — and the config layer accepts it, so the end lands on
            // the following date exactly as WorkingHours.crossesMidnight decides it does.
            LocalTime from = override.getStartTime();
            LocalTime to = override.getEndTime();
            LocalDate endDate = to.isBefore(from) ? date.plusDays(1) : date;
            addWindow(into, date, from, endDate, to, zone);
        }
    }

    /**
     * One wall-clock range, in the business zone, as instants.
     *
     * <p>{@code ZonedDateTime.of} is what makes the DST cases work, and its two documented
     * behaviours are both the ones wanted here. In a spring-forward gap it moves the local time
     * forward by the length of the gap, so a shift starting at the 02:00 that never happens starts
     * at 03:00 instead of throwing. In a fall-back overlap it takes the earlier offset, so a shift
     * starting at the first 02:00 runs for the full twenty-five-hour day rather than losing an hour.
     *
     * <p>The length check is not defensive padding, and the case that needs it is narrower than it
     * looks. A range wholly inside the gap has both ends pushed forward together and survives with
     * its length intact — 02:00–02:30 becomes 03:00–03:30, which is the right answer. A range that
     * <em>starts</em> in the gap and ends after it does not: 02:30 moves to 03:30 while 03:15 stays
     * where it is, and the result runs backwards. That is the one shape a configured range can take
     * that leaves nothing behind, and dropping it is the only answer — building it would be an
     * {@code IllegalArgumentException} thrown from inside a GET somebody typed a date into.
     */
    private static void addWindow(List<TimeWindow> into, LocalDate startDate, LocalTime startTime,
                                  LocalDate endDate, LocalTime endTime, ZoneId zone) {
        Instant start = ZonedDateTime.of(startDate, startTime, zone).toInstant();
        Instant end = ZonedDateTime.of(endDate, endTime, zone).toInstant();
        if (start.isBefore(end)) {
            into.add(new TimeWindow(start, end));
        }
    }
}
