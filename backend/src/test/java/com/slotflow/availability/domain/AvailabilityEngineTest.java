package com.slotflow.availability.domain;

import static com.slotflow.support.fixtures.Fixtures.anOverride;
import static com.slotflow.support.fixtures.Fixtures.workingHours;
import static org.assertj.core.api.Assertions.assertThat;

import com.slotflow.availability.AvailabilityOverride;
import com.slotflow.availability.WorkingHours;
import com.slotflow.availability.domain.AvailabilityQuery.StaffSchedule;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * The plan's test matrix, every row of it.
 *
 * <p>No Spring context, no database, no clock — the engine is a function, so each case here is a
 * value built in three lines and an assertion, and the whole class runs in well under a second. That
 * is the return on the pure-domain boundary, and it is why cases nobody would set up against a
 * database (a spring-forward Sunday, a booking two months out) are affordable enough to have.
 *
 * <p>The business zone is {@code Europe/Paris} throughout, because a test that passes in UTC proves
 * nothing about this code: UTC has no DST, so the hardest four rows of the matrix would all pass
 * against an engine that ignored zones entirely. Slots are asserted as <em>local</em> date-times in
 * that zone, since "the 09:00 appointment" is the thing a business recognises; the engine itself
 * returns UTC instants and {@link #localStarts} converts.
 */
class AvailabilityEngineTest {

    private static final ZoneId PARIS = ZoneId.of("Europe/Paris");

    /** Monday 2 March 2026 — the same Monday as {@code TestTime.NOW}, so the two agree. */
    private static final LocalDate MONDAY = LocalDate.of(2026, 3, 2);
    private static final LocalDate TUESDAY = MONDAY.plusDays(1);

    private static final UUID DANA = UUID.fromString("00000000-0000-0000-0000-0000000000d0");
    private static final UUID SAM = UUID.fromString("00000000-0000-0000-0000-0000000000a5");

    // ---------------------------------------------------------------------------------
    //  the ordinary day
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("a plain 09:00-17:00 day, 60 minutes on a 30 minute grid, is 15 slots from 09:00 to 16:00")
    void plainDay() {
        List<Slot> slots = query()
                .staff(DANA, dayShift(DayOfWeek.MONDAY, "09:00", "17:00"))
                .lasting(60).every(30)
                .slots();

        assertThat(slots).hasSize(15);
        assertThat(localStarts(slots)).startsWith("2026-03-02T09:00", "2026-03-02T09:30")
                .endsWith("2026-03-02T15:30", "2026-03-02T16:00");
    }

    @Test
    @DisplayName("a weekday nobody works has no slots, and no exception")
    void aDayWithNoTemplate() {
        assertThat(query()
                .staff(DANA, dayShift(DayOfWeek.TUESDAY, "09:00", "17:00"))
                .slots())
                .isEmpty();
    }

    @Test
    @DisplayName("no candidate staff is an empty answer, not an error")
    void noStaffAtAll() {
        assertThat(query().slots()).isEmpty();
    }

    // ---------------------------------------------------------------------------------
    //  daylight saving — the rows that need a real zone with a real transition
    // ---------------------------------------------------------------------------------

    @Nested
    @DisplayName("daylight saving")
    class DaylightSaving {

        /** Europe/Paris, 29 March 2026: 02:00 local never happens. */
        private static final LocalDate SPRING_FORWARD = LocalDate.of(2026, 3, 29);

        /** Europe/Paris, 25 October 2026: 02:00 local happens twice. */
        private static final LocalDate FALL_BACK = LocalDate.of(2026, 10, 25);

        @Test
        @DisplayName("the spring-forward day is 23 hours long, and the missing hour holds no slot")
        void springForward() {
            assertThat(lengthOf(SPRING_FORWARD)).isEqualTo(Duration.ofHours(23));

            List<Slot> slots = query().on(SPRING_FORWARD)
                    .staff(DANA, dayShift(DayOfWeek.SUNDAY, "01:00", "05:00"))
                    .lasting(60).every(60)
                    .slots();

            // Four wall-clock hours, three real ones: 01:00, then straight to 03:00 and 04:00.
            assertThat(localStarts(slots))
                    .containsExactly("2026-03-29T01:00", "2026-03-29T03:00", "2026-03-29T04:00");
            assertThat(localStarts(slots)).noneMatch(start -> start.endsWith("T02:00"));
        }

        @Test
        @DisplayName("the fall-back day is 25 hours long, and its two 02:00s are two distinct slots")
        void fallBack() {
            assertThat(lengthOf(FALL_BACK)).isEqualTo(Duration.ofHours(25));

            List<Slot> slots = query().on(FALL_BACK)
                    .staff(DANA, dayShift(DayOfWeek.SUNDAY, "01:00", "05:00"))
                    .lasting(60).every(60)
                    .slots();

            // Five real hours in four wall-clock ones. 02:00 appears twice as a local time and
            // never twice as an instant, which is the whole difference this test exists to pin.
            assertThat(localStarts(slots)).containsExactly("2026-10-25T01:00", "2026-10-25T02:00",
                    "2026-10-25T02:00", "2026-10-25T03:00", "2026-10-25T04:00");
            assertThat(slots.stream().map(Slot::start).distinct()).hasSize(5);
        }

        @Test
        @DisplayName("a shift wholly inside the missing hour moves past it, keeping its length")
        void aShiftInsideTheGapMovesPastIt() {
            // Both ends are pushed forward by the length of the gap, so half an hour of work
            // stays half an hour of work and lands at 03:00. Losing it instead would be the
            // defensible alternative; moving it is what java.time does, and it is the reading a
            // night worker would recognise.
            List<Slot> slots = query().on(SPRING_FORWARD)
                    .staff(DANA, dayShift(DayOfWeek.SUNDAY, "02:00", "02:30"))
                    .lasting(30).every(30)
                    .slots();

            assertThat(localStarts(slots)).containsExactly("2026-03-29T03:00");
        }

        @Test
        @DisplayName("a shift starting in the missing hour and ending after it vanishes, and does not throw")
        void aShiftStraddlingTheGapVanishes() {
            // 02:30 does not exist and is pushed to 03:30; 03:15 does exist and stays put. The
            // range therefore runs backwards, which is not a window at all — and it is the one
            // shape a configured range can take that leaves nothing behind. Dropping it is the
            // only answer; constructing it would be an IllegalArgumentException from inside a
            // GET that a customer typed a date into.
            List<Slot> slots = query().on(SPRING_FORWARD)
                    .staff(DANA, dayShift(DayOfWeek.SUNDAY, "02:30", "03:15"))
                    .lasting(30).every(30)
                    .slots();

            assertThat(slots).isEmpty();
        }

        @Test
        @DisplayName("an EXTRA window straddling the missing hour vanishes the same way")
        void anExtraStraddlingTheGapVanishes() {
            List<Slot> slots = query().on(SPRING_FORWARD)
                    .staff(new StaffSchedule(DANA, List.of(),
                            List.of(extraBetween(DANA, SPRING_FORWARD, "02:30", "03:15")), List.of()))
                    .lasting(30).every(30)
                    .slots();

            assertThat(slots).isEmpty();
        }

        private static Duration lengthOf(LocalDate date) {
            return Duration.between(date.atStartOfDay(PARIS), date.plusDays(1).atStartOfDay(PARIS));
        }
    }

    // ---------------------------------------------------------------------------------
    //  midnight
    // ---------------------------------------------------------------------------------

    @Nested
    @DisplayName("shifts that cross midnight")
    class AcrossMidnight {

        @Test
        @DisplayName("a 22:00-02:00 shift puts slots on both dates, each attributed to the date it starts")
        void nightShiftSpansTwoDates() {
            List<Slot> slots = query().from(MONDAY).to(TUESDAY)
                    .staff(DANA, dayShift(DayOfWeek.MONDAY, "22:00", "02:00"))
                    .lasting(60).every(60)
                    .slots();

            assertThat(localStarts(slots)).containsExactly("2026-03-02T22:00", "2026-03-02T23:00",
                    "2026-03-03T00:00", "2026-03-03T01:00");
        }

        @Test
        @DisplayName("asking for Monday alone stops at midnight: the small hours belong to Tuesday")
        void mondayAloneStopsAtMidnight() {
            List<Slot> slots = query().on(MONDAY)
                    .staff(DANA, dayShift(DayOfWeek.MONDAY, "22:00", "02:00"))
                    .lasting(60).every(60)
                    .slots();

            assertThat(localStarts(slots))
                    .containsExactly("2026-03-02T22:00", "2026-03-02T23:00");
        }

        @Test
        @DisplayName("asking for Tuesday alone still finds the tail of Monday night's shift")
        void tuesdayAloneSeesTheTailOfMondayNight() {
            List<Slot> slots = query().on(TUESDAY)
                    .staff(DANA, dayShift(DayOfWeek.MONDAY, "22:00", "02:00"))
                    .lasting(60).every(60)
                    .slots();

            // The shift belongs to Monday's row in the template and the scan has to reach back a
            // day to find it. Without that, a night worker's early hours would be unbookable.
            assertThat(localStarts(slots))
                    .containsExactly("2026-03-03T00:00", "2026-03-03T01:00");
        }

        @Test
        @DisplayName("a BLOCKED override dated after the range still cuts the slot that runs into it")
        void aCutOnTheDayAfterTheRangeStillApplies() {
            List<Slot> slots = query().on(MONDAY)
                    .staff(new StaffSchedule(DANA, dayShift(DayOfWeek.MONDAY, "22:00", "02:00"),
                            List.of(blockedBetween(DANA, TUESDAY, "00:00", "06:00")), List.of()))
                    .lasting(120).every(60)
                    .slots();

            // Asking for Monday alone, the scan still has to reach forwards into Tuesday: 23:00 is a
            // Monday start whose two hours run to 01:00, straight through a closure dated Tuesday.
            // Offering it would be the engine promising a slot the constraint would then refuse.
            assertThat(localStarts(slots)).containsExactly("2026-03-02T22:00");
        }

        @Test
        @DisplayName("the scanned span reaches a day past the range at each end, load window with it")
        void theScannedSpanReachesPastBothEnds() {
            TimeWindow monday = new TimeWindow(
                    parisTime("2026-03-02T00:00"), parisTime("2026-03-03T00:00"));

            assertThat(AvailabilityEngine.datesToScan(monday, PARIS))
                    .containsExactly(MONDAY.minusDays(1), MONDAY, TUESDAY);
            // The service loads bookings over exactly those dates, end to end. The far end is what
            // stops a booking sitting just past the last requested midnight from going unseen.
            assertThat(AvailabilityEngine.loadWindow(monday, PARIS)).isEqualTo(new TimeWindow(
                    parisTime("2026-03-01T00:00"), parisTime("2026-03-04T00:00")));
        }
    }

    // ---------------------------------------------------------------------------------
    //  buffers
    // ---------------------------------------------------------------------------------

    @Nested
    @DisplayName("buffers")
    class Buffers {

        @Test
        @DisplayName("a booking's buffers are respected on both sides, and no slot half-overlaps it")
        void bookingWithBuffersAtTheEdgeOfTheWindow() {
            // A 12:00 appointment with ten minutes either side costs the calendar 11:50-13:10.
            TimeWindow booked = new TimeWindow(parisTime("2026-03-02T11:50"), parisTime("2026-03-02T13:10"));

            List<Slot> slots = query()
                    .staff(new StaffSchedule(DANA, dayShift(DayOfWeek.MONDAY, "09:00", "17:00"),
                            List.of(), List.of(booked)))
                    .lasting(60).withBuffers(10, 10).every(30)
                    .slots();

            assertThat(localStarts(slots)).containsExactly(
                    // The morning stops early enough that the last appointment's cleanup ends by
                    // 11:50, and the afternoon starts late enough that its setup begins after 13:10.
                    "2026-03-02T09:30", "2026-03-02T10:00", "2026-03-02T10:30",
                    "2026-03-02T13:40", "2026-03-02T14:10", "2026-03-02T14:40",
                    "2026-03-02T15:10", "2026-03-02T15:40");
            assertThat(slots).noneMatch(slot -> blockedWindow(slot, 10, 10).overlaps(booked));
        }

        @Test
        @DisplayName("the setup buffer may not spill past the opening time, so 09:00 itself is not offered")
        void setupBufferMayNotSpillPastOpening() {
            List<Slot> slots = query()
                    .staff(DANA, dayShift(DayOfWeek.MONDAY, "09:00", "17:00"))
                    .lasting(60).withBuffers(10, 0).every(30)
                    .slots();

            // Setting up at 08:50 means opening at 08:50. The first bookable start is the next
            // point on the grid whose setup fits inside the day.
            assertThat(localStarts(slots)).startsWith("2026-03-02T09:30");
        }

        @Test
        @DisplayName("a cleanup buffer that would run past closing removes the last slot")
        void cleanupBufferRemovesTheLastSlot() {
            List<Slot> withBuffer = query()
                    .staff(DANA, dayShift(DayOfWeek.MONDAY, "09:00", "17:00"))
                    .lasting(60).withBuffers(0, 15).every(30)
                    .slots();

            // 16:00 + 60 + 15 is 17:15, past the door being locked. 15:30 is the last one that fits.
            assertThat(localStarts(withBuffer)).endsWith("2026-03-02T15:30")
                    .doesNotContain("2026-03-02T16:00");
        }

        @Test
        @DisplayName("a service longer than the whole window is an empty answer, not an exception")
        void serviceLongerThanTheWindow() {
            assertThat(query()
                    .staff(DANA, dayShift(DayOfWeek.MONDAY, "09:00", "12:00"))
                    .lasting(240).every(30)
                    .slots())
                    .isEmpty();
        }
    }

    // ---------------------------------------------------------------------------------
    //  overrides, and the precedence rule
    // ---------------------------------------------------------------------------------

    @Nested
    @DisplayName("overrides")
    class Overrides {

        @Test
        @DisplayName("a whole-day BLOCKED override empties the day")
        void wholeDayBlockedEmptiesTheDay() {
            assertThat(query()
                    .staff(new StaffSchedule(DANA, dayShift(DayOfWeek.MONDAY, "09:00", "17:00"),
                            List.of(blockedDay(DANA, MONDAY)), List.of()))
                    .slots())
                    .isEmpty();
        }

        @Test
        @DisplayName("a BLOCKED range takes an afternoon out and leaves the morning alone")
        void blockedRangeTakesPartOfTheDay() {
            List<Slot> slots = query()
                    .staff(new StaffSchedule(DANA, dayShift(DayOfWeek.MONDAY, "09:00", "17:00"),
                            List.of(blockedBetween(DANA, MONDAY, "12:00", "17:00")), List.of()))
                    .lasting(60).every(60)
                    .slots();

            assertThat(localStarts(slots)).containsExactly(
                    "2026-03-02T09:00", "2026-03-02T10:00", "2026-03-02T11:00");
        }

        @Test
        @DisplayName("an EXTRA window outside the template opens slots there")
        void extraOutsideWorkingHours() {
            List<Slot> slots = query()
                    .staff(new StaffSchedule(DANA, dayShift(DayOfWeek.MONDAY, "09:00", "17:00"),
                            List.of(extraBetween(DANA, MONDAY, "18:00", "20:00")), List.of()))
                    .lasting(60).every(60)
                    .slots();

            assertThat(localStarts(slots)).endsWith("2026-03-02T18:00", "2026-03-02T19:00");
        }

        @Test
        @DisplayName("an EXTRA that touches the template extends it rather than starting a new grid")
        void extraTouchingTheTemplateCoalesces() {
            List<Slot> slots = query()
                    .staff(new StaffSchedule(DANA, dayShift(DayOfWeek.MONDAY, "09:00", "12:00"),
                            List.of(extraBetween(DANA, MONDAY, "12:00", "14:00")), List.of()))
                    .lasting(60).every(60)
                    .slots();

            // Five hours in one piece. Two windows would have restarted the walk at 12:00 anyway
            // here, but a 90-minute service on the same shape would have lost the slot at 11:30.
            assertThat(localStarts(slots)).containsExactly("2026-03-02T09:00", "2026-03-02T10:00",
                    "2026-03-02T11:00", "2026-03-02T12:00", "2026-03-02T13:00");
        }

        @Test
        @DisplayName("a BLOCKED override may cross midnight, and ends on the following date")
        void blockedOverrideCrossesMidnight() {
            List<Slot> slots = query().from(MONDAY).to(TUESDAY)
                    .staff(new StaffSchedule(DANA, dayShift(DayOfWeek.MONDAY, "22:00", "02:00"),
                            List.of(blockedBetween(DANA, MONDAY, "23:00", "01:00")), List.of()))
                    .lasting(60).every(60)
                    .slots();

            assertThat(localStarts(slots))
                    .containsExactly("2026-03-02T22:00", "2026-03-03T01:00");
        }

        @Test
        @DisplayName("a staff EXTRA inside a business-wide BLOCKED is still nothing: BLOCKED wins")
        void staffExtraCannotReopenABusinessWideClosure() {
            assertThat(query()
                    .closedBusinessWide(blockedDay(null, MONDAY))
                    .staff(new StaffSchedule(DANA, dayShift(DayOfWeek.MONDAY, "09:00", "17:00"),
                            List.of(extraBetween(DANA, MONDAY, "18:00", "20:00")), List.of()))
                    .slots())
                    .isEmpty();
        }

        @Test
        @DisplayName("precedence does not depend on insertion order, in either direction")
        void precedenceIsOrderIndependent() {
            AvailabilityOverride closure = blockedDay(DANA, MONDAY);
            AvailabilityOverride evening = extraBetween(DANA, MONDAY, "18:00", "20:00");
            List<WorkingHours> template = dayShift(DayOfWeek.MONDAY, "09:00", "17:00");

            assertThat(query()
                    .staff(new StaffSchedule(DANA, template, List.of(closure, evening), List.of()))
                    .slots())
                    .isEmpty();
            assertThat(query()
                    .staff(new StaffSchedule(DANA, template, List.of(evening, closure), List.of()))
                    .slots())
                    .isEmpty();
        }

        @Test
        @DisplayName("a business-wide closure with times shuts only those hours, for everybody")
        void businessWidePartialClosure() {
            List<Slot> slots = query()
                    .closedBusinessWide(AvailabilityOverride.businessWideClosure(
                            UUID.randomUUID(), MONDAY,
                            java.time.LocalTime.of(12, 0), java.time.LocalTime.of(17, 0), "Staff meeting"))
                    .staff(DANA, dayShift(DayOfWeek.MONDAY, "09:00", "17:00"))
                    .lasting(60).every(60)
                    .slots();

            assertThat(localStarts(slots)).containsExactly(
                    "2026-03-02T09:00", "2026-03-02T10:00", "2026-03-02T11:00");
        }
    }

    // ---------------------------------------------------------------------------------
    //  policy
    // ---------------------------------------------------------------------------------

    @Nested
    @DisplayName("policy")
    class Policy {

        /** {@code TestTime.NOW}: Monday 2 March 2026, 09:00 UTC, which is 10:00 in Paris. */
        private static final Instant NOW = Instant.parse("2026-03-02T09:00:00Z");

        @Test
        @DisplayName("a 24-hour lead time removes today entirely and leaves tomorrow partial")
        void leadTimeRemovesTodayAndTrimsTomorrow() {
            List<Slot> slots = query().from(MONDAY).to(TUESDAY)
                    .notBefore(NOW.plus(Duration.ofHours(24)))
                    .staff(DANA, dayShift("09:00", "17:00", DayOfWeek.MONDAY, DayOfWeek.TUESDAY))
                    .lasting(60).every(60)
                    .slots();

            assertThat(localStarts(slots)).noneMatch(start -> start.startsWith("2026-03-02"));
            // 09:00 UTC tomorrow is 10:00 in Paris, and landing exactly on the boundary is allowed.
            assertThat(localStarts(slots)).startsWith("2026-03-03T10:00")
                    .endsWith("2026-03-03T16:00");
        }

        @Test
        @DisplayName("a seven-day horizon leaves nothing on day eight")
        void maxAdvanceClosesTheCalendar() {
            List<Slot> slots = query().from(MONDAY).to(MONDAY.plusDays(14))
                    .notAfter(NOW.plus(Duration.ofDays(7)))
                    .staff(DANA, dayShift("09:00", "17:00", DayOfWeek.MONDAY, DayOfWeek.TUESDAY,
                            DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY, DayOfWeek.FRIDAY))
                    .lasting(60).every(60)
                    .slots();

            // Day 7 is Monday the 9th and it is still partly open; day 8 is gone completely.
            assertThat(localStarts(slots)).endsWith("2026-03-09T09:00", "2026-03-09T10:00");
            assertThat(localStarts(slots)).noneMatch(start -> start.startsWith("2026-03-10"));
        }
    }

    // ---------------------------------------------------------------------------------
    //  any staff
    // ---------------------------------------------------------------------------------

    @Nested
    @DisplayName("any staff")
    class AnyStaff {

        @Test
        @DisplayName("two staff with overlapping hours union into one deduped list of starts")
        void unionDedupedByStart() {
            List<Slot> slots = query()
                    .staff(DANA, dayShift(DayOfWeek.MONDAY, "09:00", "13:00"))
                    .staff(SAM, dayShift(DayOfWeek.MONDAY, "11:00", "17:00"))
                    .lasting(60).every(60)
                    .slots();

            assertThat(localStarts(slots)).containsExactly("2026-03-02T09:00", "2026-03-02T10:00",
                    "2026-03-02T11:00", "2026-03-02T12:00", "2026-03-02T13:00", "2026-03-02T14:00",
                    "2026-03-02T15:00", "2026-03-02T16:00");
            assertThat(slots.stream().map(Slot::start).distinct()).hasSize(slots.size());
        }

        @Test
        @DisplayName("a slot records every staff member who could serve it, so booking can choose")
        void slotsCarryTheirCandidates() {
            List<Slot> slots = query()
                    .staff(DANA, dayShift(DayOfWeek.MONDAY, "09:00", "13:00"))
                    .staff(SAM, dayShift(DayOfWeek.MONDAY, "11:00", "17:00"))
                    .lasting(60).every(60)
                    .slots();

            assertThat(slotAt(slots, "2026-03-02T09:00").staffIds()).containsExactly(DANA);
            assertThat(slotAt(slots, "2026-03-02T15:00").staffIds()).containsExactly(SAM);
            // Sorted, so the order is the same on every run whatever order the staff were loaded in.
            assertThat(slotAt(slots, "2026-03-02T11:00").staffIds())
                    .containsExactly(SAM, DANA)
                    .isSorted();
        }

        @Test
        @DisplayName("one staff member being fully booked leaves the other's slots on offer")
        void oneFullyBookedStaffMember() {
            TimeWindow wholeDay = new TimeWindow(
                    parisTime("2026-03-02T09:00"), parisTime("2026-03-02T17:00"));

            List<Slot> slots = query()
                    .staff(new StaffSchedule(DANA, dayShift(DayOfWeek.MONDAY, "09:00", "17:00"),
                            List.of(), List.of(wholeDay)))
                    .staff(SAM, dayShift(DayOfWeek.MONDAY, "09:00", "17:00"))
                    .lasting(60).every(60)
                    .slots();

            assertThat(slots).hasSize(8);
            assertThat(slots).allMatch(slot -> slot.staffIds().equals(List.of(SAM)));
        }
    }

    // ---------------------------------------------------------------------------------
    //  split shifts
    // ---------------------------------------------------------------------------------

    @Nested
    @DisplayName("split shifts")
    class SplitShifts {

        @Test
        @DisplayName("no slot spans the lunch gap of a 09:00-12:00 / 13:00-17:00 day")
        void noSlotSpansTheLunchGap() {
            List<Slot> slots = query()
                    .staff(DANA, split("09:00", "12:00", "13:00", "17:00"))
                    .lasting(60).every(30)
                    .slots();

            assertThat(localStarts(slots)).containsExactly(
                    "2026-03-02T09:00", "2026-03-02T09:30", "2026-03-02T10:00", "2026-03-02T10:30",
                    "2026-03-02T11:00",
                    "2026-03-02T13:00", "2026-03-02T13:30", "2026-03-02T14:00", "2026-03-02T14:30",
                    "2026-03-02T15:00", "2026-03-02T15:30", "2026-03-02T16:00");

            TimeWindow lunch = new TimeWindow(
                    parisTime("2026-03-02T12:00"), parisTime("2026-03-02T13:00"));
            assertThat(slots).noneMatch(slot -> slot.window().overlaps(lunch));
        }

        @Test
        @DisplayName("a split shift with no gap is one unbroken window, so 11:30 is bookable")
        void aGaplessSplitCoalesces() {
            List<Slot> slots = query()
                    .staff(DANA, split("09:00", "12:00", "12:00", "17:00"))
                    .lasting(60).every(30)
                    .slots();

            // Two rows in the template, eight unbroken hours in reality. Walking them separately
            // would drop 11:30 and offer 12:00 twice.
            assertThat(localStarts(slots)).contains("2026-03-02T11:30").hasSize(15);
        }
    }

    // ---------------------------------------------------------------------------------
    //  the customer's timezone (D11)
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("?tz= moves only the day boundaries; working hours stay in the business zone")
    void theCustomerZoneMovesOnlyTheDayBoundaries() {
        // A customer in Tokyo asking for "Monday" is asking for the Tokyo Monday, which ends at
        // 16:00 Paris time. The salon still opens at 09:00 Paris, not at 09:00 Tokyo.
        List<Slot> slots = query().on(MONDAY).inCustomerZone(ZoneId.of("Asia/Tokyo"))
                .staff(DANA, dayShift(DayOfWeek.MONDAY, "09:00", "17:00"))
                .lasting(60).every(30)
                .slots();

        assertThat(localStarts(slots)).startsWith("2026-03-02T09:00").endsWith("2026-03-02T15:30");
    }

    @Test
    @DisplayName("every returned instant is UTC and the end is the start plus the duration")
    void slotsAreUtcInstantsOfTheServiceDuration() {
        List<Slot> slots = query()
                .staff(DANA, dayShift(DayOfWeek.MONDAY, "09:00", "17:00"))
                .lasting(45).every(60)
                .slots();

        assertThat(slots.getFirst().start()).isEqualTo(Instant.parse("2026-03-02T08:00:00Z"));
        assertThat(slots).allMatch(slot -> slot.window().durationMinutes() == 45);
    }

    // =================================================================================
    //  fixtures
    // =================================================================================

    private static QueryBuilder query() {
        return new QueryBuilder();
    }

    /**
     * A readable way to spell one of these cases.
     *
     * <p>Every default is the boring one — Paris, one Monday, a 60-minute service on a 30-minute
     * grid and no policy limits — so a test that sets {@code withBuffers(10, 10)} is visibly a test
     * about buffers. The same argument as the fixture builders in {@code support.fixtures}, kept
     * local because {@link AvailabilityQuery} is the only thing it builds.
     */
    private static final class QueryBuilder {

        private LocalDate from = MONDAY;
        private LocalDate to = MONDAY;
        private ZoneId customerZone;
        private int durationMinutes = 60;
        private int bufferBefore;
        private int bufferAfter;
        private int granularity = 30;
        private Instant earliest = Instant.MIN;
        private Instant latest = Instant.MAX;
        private final List<AvailabilityOverride> businessWide = new ArrayList<>();
        private final List<StaffSchedule> staff = new ArrayList<>();

        QueryBuilder on(LocalDate date) {
            return from(date).to(date);
        }

        QueryBuilder from(LocalDate from) {
            this.from = from;
            return this;
        }

        QueryBuilder to(LocalDate to) {
            this.to = to;
            return this;
        }

        QueryBuilder inCustomerZone(ZoneId zone) {
            this.customerZone = zone;
            return this;
        }

        QueryBuilder lasting(int durationMinutes) {
            this.durationMinutes = durationMinutes;
            return this;
        }

        QueryBuilder withBuffers(int before, int after) {
            this.bufferBefore = before;
            this.bufferAfter = after;
            return this;
        }

        QueryBuilder every(int granularityMinutes) {
            this.granularity = granularityMinutes;
            return this;
        }

        QueryBuilder notBefore(Instant earliest) {
            this.earliest = earliest;
            return this;
        }

        QueryBuilder notAfter(Instant latest) {
            this.latest = latest;
            return this;
        }

        QueryBuilder closedBusinessWide(AvailabilityOverride closure) {
            this.businessWide.add(closure);
            return this;
        }

        QueryBuilder staff(UUID staffId, List<WorkingHours> template) {
            return staff(StaffSchedule.of(staffId, template));
        }

        QueryBuilder staff(StaffSchedule schedule) {
            this.staff.add(schedule);
            return this;
        }

        List<Slot> slots() {
            ZoneId dayBoundaries = customerZone != null ? customerZone : PARIS;
            TimeWindow range = new TimeWindow(
                    from.atStartOfDay(dayBoundaries).toInstant(),
                    to.plusDays(1).atStartOfDay(dayBoundaries).toInstant());
            return AvailabilityEngine.slots(new AvailabilityQuery(PARIS, range, durationMinutes,
                    bufferBefore, bufferAfter, granularity, earliest, latest,
                    List.copyOf(businessWide), List.copyOf(staff)));
        }
    }

    private static List<WorkingHours> dayShift(DayOfWeek day, String from, String to) {
        return dayShift(from, to, day);
    }

    private static List<WorkingHours> dayShift(String from, String to, DayOfWeek... days) {
        return Arrays.stream(days)
                .map(day -> workingHours().forStaff(DANA).on(day).from(from).to(to).build())
                .toList();
    }

    private static List<WorkingHours> split(String morningFrom, String morningTo,
            String afternoonFrom, String afternoonTo) {
        return List.of(
                workingHours().forStaff(DANA).on(DayOfWeek.MONDAY)
                        .from(morningFrom).to(morningTo).build(),
                workingHours().forStaff(DANA).on(DayOfWeek.MONDAY)
                        .from(afternoonFrom).to(afternoonTo).build());
    }

    private static AvailabilityOverride blockedDay(UUID staffId, LocalDate date) {
        return staffId == null
                ? anOverride().businessWide().on(date).wholeDay().blocked().build()
                : anOverride().forStaff(staffId).on(date).wholeDay().blocked().build();
    }

    private static AvailabilityOverride blockedBetween(UUID staffId, LocalDate date,
            String from, String to) {
        return anOverride().forStaff(staffId).on(date).between(from, to).blocked().build();
    }

    private static AvailabilityOverride extraBetween(UUID staffId, LocalDate date,
            String from, String to) {
        return anOverride().forStaff(staffId).on(date).between(from, to).extra().build();
    }

    // ---------------------------------------------------------------------------------
    //  assertions read in the business zone, because that is the language a salon speaks
    // ---------------------------------------------------------------------------------

    private static List<String> localStarts(List<Slot> slots) {
        return slots.stream()
                .map(slot -> LocalDateTime.ofInstant(slot.start(), PARIS).toString())
                .toList();
    }

    private static Slot slotAt(List<Slot> slots, String parisLocalDateTime) {
        Instant start = parisTime(parisLocalDateTime);
        return slots.stream()
                .filter(slot -> slot.start().equals(start))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no slot at " + parisLocalDateTime
                        + " among " + localStarts(slots)));
    }

    private static Instant parisTime(String localDateTime) {
        return LocalDateTime.parse(localDateTime).atZone(PARIS).toInstant();
    }

    /** What one appointment would actually cost the calendar, buffers included (D4). */
    private static TimeWindow blockedWindow(Slot slot, int bufferBefore, int bufferAfter) {
        return new TimeWindow(slot.start().minusSeconds(bufferBefore * 60L),
                slot.end().plusSeconds(bufferAfter * 60L));
    }
}
