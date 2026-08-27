package com.slotflow.availability.domain;

import com.slotflow.availability.AvailabilityOverride;
import com.slotflow.availability.WorkingHours;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

/**
 * Everything {@link AvailabilityEngine} needs, already loaded.
 *
 * <p>This record <em>is</em> the pure-domain boundary the plan is built around. The engine takes one
 * of these and returns slots; it never asks a repository a question, never reads a clock, and never
 * learns what a business or a service is. That is what makes the sixteen-case test matrix affordable
 * — every one of those cases is a value built in three lines and an assertion that runs in
 * microseconds — and it is the single decision that keeps this plan at ten hours.
 *
 * <p>The corollary is that assembling one is somebody else's job, and it is {@code
 * AvailabilityService}'s: three queries for the whole range and all candidate staff, never one per
 * day.
 *
 * @param businessZone         where working hours are read (D11). Never the customer's zone: a salon
 *                             opens at 09:00 local whatever the phone booking it says
 * @param range                the requested span as instants. {@code ?tz=} has already been applied
 *                             — it decides only where the {@code from}/{@code to} <em>days</em>
 *                             begin and end, and by the time it reaches here it has done its work.
 *                             A slot is offered when its <b>start</b> falls inside this window
 * @param durationMinutes      the service duration the customer sees
 * @param bufferBeforeMinutes  setup time, which must fit inside the working window
 * @param bufferAfterMinutes   cleanup time, likewise
 * @param slotGranularityMinutes the step between offered starts
 * @param earliestStart        policy floor: {@code now + minLeadTimeHours}
 * @param latestStart          policy ceiling: {@code now + maxAdvanceDays}
 * @param businessWide         closures that apply to everybody (D5). {@code BLOCKED} only — the
 *                             config layer refuses a business-wide {@code EXTRA}, and the engine
 *                             ignores one if it ever sees it
 * @param staff                one entry per candidate staff member. A named staff query has already
 *                             been narrowed to one; an any-staff query carries everybody who
 *                             performs the service. Empty means no slots, and no work
 */
public record AvailabilityQuery(
        ZoneId businessZone,
        TimeWindow range,
        int durationMinutes,
        int bufferBeforeMinutes,
        int bufferAfterMinutes,
        int slotGranularityMinutes,
        Instant earliestStart,
        Instant latestStart,
        List<AvailabilityOverride> businessWide,
        List<StaffSchedule> staff) {

    public AvailabilityQuery {
        requireNotNull(businessZone, "businessZone");
        requireNotNull(range, "range");
        requireNotNull(earliestStart, "earliestStart");
        requireNotNull(latestStart, "latestStart");
        requirePositive(durationMinutes, "durationMinutes");
        requirePositive(slotGranularityMinutes, "slotGranularityMinutes");
        requireNotNegative(bufferBeforeMinutes, "bufferBeforeMinutes");
        requireNotNegative(bufferAfterMinutes, "bufferAfterMinutes");
        businessWide = List.copyOf(requireNotNull(businessWide, "businessWide"));
        staff = List.copyOf(requireNotNull(staff, "staff"));
    }

    /**
     * One staff member's whole calendar for the range, in the three shapes the pipeline consumes.
     *
     * <p>Bookings arrive as plain windows rather than as {@code Booking} rows, and that is not
     * squeamishness about the entity: what the engine subtracts is {@code [blocked_from,
     * blocked_to)} — the buffer-expanded range already stored on the row (D4) — and passing the
     * window makes it impossible for this code to subtract the customer-visible one by mistake. It
     * is the same interval the database's exclusion constraint ranges over, so the engine and the
     * constraint agree by construction rather than by both being written carefully.
     *
     * @param staffId      whose calendar this is
     * @param workingHours the whole weekly template, every weekday. The engine picks the rows for
     *                     each date rather than the caller pre-grouping them, because a shift that
     *                     crosses midnight belongs to two dates
     * @param overrides    this staff member's own, {@code BLOCKED} and {@code EXTRA} alike
     * @param busy         the blocked windows of their {@code PENDING} and {@code CONFIRMED}
     *                     bookings
     */
    public record StaffSchedule(UUID staffId, List<WorkingHours> workingHours,
            List<AvailabilityOverride> overrides, List<TimeWindow> busy) {

        public StaffSchedule {
            requireNotNull(staffId, "staffId");
            workingHours = List.copyOf(requireNotNull(workingHours, "workingHours"));
            overrides = List.copyOf(requireNotNull(overrides, "overrides"));
            busy = List.copyOf(requireNotNull(busy, "busy"));
        }

        /** The common case: hours and nothing else — no day off, no appointments yet. */
        public static StaffSchedule of(UUID staffId, List<WorkingHours> workingHours) {
            return new StaffSchedule(staffId, workingHours, List.of(), List.of());
        }
    }

    /**
     * How long one appointment costs the calendar: the duration plus both buffers.
     *
     * <p>The same arithmetic {@code ServiceOffering.totalBlockMinutes} performs, restated here
     * because the engine is not allowed to import the catalog — and asserted equal to it by the
     * endpoint's integration test, which is the honest way to keep two definitions in step.
     */
    public long totalBlockMinutes() {
        return (long) bufferBeforeMinutes + durationMinutes + bufferAfterMinutes;
    }

    private static <T> T requireNotNull(T value, String field) {
        if (value == null) {
            throw new IllegalArgumentException(field + " must not be null");
        }
        return value;
    }

    private static void requirePositive(int value, String field) {
        if (value <= 0) {
            throw new IllegalArgumentException(field + " must be positive");
        }
    }

    private static void requireNotNegative(int value, String field) {
        if (value < 0) {
            throw new IllegalArgumentException(field + " must not be negative");
        }
    }
}
