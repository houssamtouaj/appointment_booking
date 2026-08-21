package com.slotflow.availability;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The midnight crossing, and the reason working hours are wall-clock times.
 *
 * <p>The last test here does not touch {@link WorkingHours} at all. It pins down the property the
 * whole design rests on: 09:00 stays 09:00 across a DST boundary, which is only true because the
 * column is a {@code time} and not a {@code timestamptz}. Plan 09 leans on it in every one of its
 * DST cases, so it is worth one assertion here to say it out loud.
 */
class WorkingHoursTest {

    private static final UUID STAFF_ID = UUID.randomUUID();

    @Test
    @DisplayName("an ordinary day shift does not cross midnight")
    void ordinaryShift() {
        WorkingHours hours = hours(LocalTime.of(9, 0), LocalTime.of(17, 0));

        assertThat(hours.crossesMidnight()).isFalse();
        assertThat(hours.durationMinutes()).isEqualTo(8 * 60);
    }

    @Test
    @DisplayName("an end time before the start time means a night shift, and is legal")
    void nightShiftCrossesMidnight() {
        WorkingHours hours = hours(LocalTime.of(22, 0), LocalTime.of(2, 0));

        assertThat(hours.crossesMidnight()).isTrue();
        // Four hours, not the twenty the naive subtraction would produce.
        assertThat(hours.durationMinutes()).isEqualTo(4 * 60);
    }

    @Test
    @DisplayName("a shift ending at midnight counts as crossing, so its end lands on the next date")
    void endingAtMidnightCountsAsCrossing() {
        WorkingHours hours = hours(LocalTime.of(18, 0), LocalTime.MIDNIGHT);

        // 00:00 is "before" 18:00 as a LocalTime, and treating that as a crossing is correct
        // rather than incidental: the engine has to materialise the end as 00:00 on date + 1,
        // or an evening shift would collapse to a zero-length window.
        assertThat(hours.crossesMidnight()).isTrue();
        assertThat(hours.durationMinutes()).isEqualTo(6 * 60);
    }

    @Test
    @DisplayName("a zero-length range is refused: only end-before-start carries a meaning")
    void refusesAZeroLengthRange() {
        assertThatThrownBy(() -> hours(LocalTime.of(9, 0), LocalTime.of(9, 0)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("crosses midnight");
    }

    @Test
    @DisplayName("split shifts are two rows for the same weekday, which is why the pair is not unique")
    void splitShiftsAreTwoRows() {
        WorkingHours morning = hours(LocalTime.of(9, 0), LocalTime.of(12, 0));
        WorkingHours afternoon = hours(LocalTime.of(13, 0), LocalTime.of(17, 0));

        assertThat(morning.getDayOfWeek()).isEqualTo(afternoon.getDayOfWeek());
        assertThat(morning).isNotEqualTo(afternoon);
        assertThat(morning.durationMinutes() + afternoon.durationMinutes()).isEqualTo(7 * 60);
    }

    // ---------------------------------------------------------------------------------
    //  the overlap rule (plan 08)
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("a split shift with a gap, and one without, are both consistent")
    void splitShiftsDoNotOverlap() {
        assertThat(WorkingHours.findOverlap(List.of(
                on(DayOfWeek.MONDAY, "09:00", "12:00"),
                on(DayOfWeek.MONDAY, "13:00", "17:00"))))
                .isEmpty();

        // Touching, not overlapping: half-open intervals, so a shop that changes staff at noon is
        // expressible. The booking exclusion constraint uses the same convention.
        assertThat(WorkingHours.findOverlap(List.of(
                on(DayOfWeek.MONDAY, "09:00", "12:00"),
                on(DayOfWeek.MONDAY, "12:00", "17:00"))))
                .isEmpty();
    }

    @Test
    @DisplayName("two ranges sharing an hour on one day are reported against that day")
    void overlapWithinADay() {
        assertThat(WorkingHours.findOverlap(List.of(
                on(DayOfWeek.WEDNESDAY, "09:00", "13:00"),
                on(DayOfWeek.WEDNESDAY, "12:00", "17:00"))))
                .contains(DayOfWeek.WEDNESDAY);

        // Identical rows overlap themselves, which is how a duplicated grid row is caught.
        assertThat(WorkingHours.findOverlap(List.of(
                on(DayOfWeek.FRIDAY, "09:00", "17:00"),
                on(DayOfWeek.FRIDAY, "09:00", "17:00"))))
                .contains(DayOfWeek.FRIDAY);
    }

    @Test
    @DisplayName("a night shift is consistent with the next day, until it is not")
    void overlapAcrossMidnight() {
        // Monday 22:00 to Tuesday 02:00 alongside a Tuesday afternoon: no conflict.
        assertThat(WorkingHours.findOverlap(List.of(
                on(DayOfWeek.MONDAY, "22:00", "02:00"),
                on(DayOfWeek.TUESDAY, "14:00", "18:00"))))
                .isEmpty();

        // The same night shift alongside a Tuesday range starting at 01:00. Neither overlaps
        // anything "within a day", and the person is working Tuesday 01:00 twice.
        assertThat(WorkingHours.findOverlap(List.of(
                on(DayOfWeek.MONDAY, "22:00", "02:00"),
                on(DayOfWeek.TUESDAY, "01:00", "03:00"))))
                .contains(DayOfWeek.TUESDAY);
    }

    @Test
    @DisplayName("a Sunday night shift wraps onto Monday, and is checked there")
    void theWeekIsCircular() {
        // Sunday 23:00 to Monday 01:00. The week has to close on itself or this is the one
        // overlap the check cannot see — and it is the shape a seven-day rota actually produces.
        assertThat(WorkingHours.findOverlap(List.of(
                on(DayOfWeek.SUNDAY, "23:00", "01:00"),
                on(DayOfWeek.MONDAY, "00:30", "08:00"))))
                .contains(DayOfWeek.MONDAY);

        assertThat(WorkingHours.findOverlap(List.of(
                on(DayOfWeek.SUNDAY, "23:00", "01:00"),
                on(DayOfWeek.MONDAY, "01:00", "08:00"))))
                .isEmpty();
    }

    @Test
    @DisplayName("an empty week and a single range are both consistent")
    void trivialTemplatesAreConsistent() {
        assertThat(WorkingHours.findOverlap(List.of())).isEmpty();
        assertThat(WorkingHours.findOverlap(List.of(on(DayOfWeek.MONDAY, "09:00", "17:00"))))
                .isEmpty();
    }

    @Test
    @DisplayName("a wall-clock 09:00 survives a DST change, which an Instant would not")
    void wallClockTimesSurviveDst() {
        ZoneId paris = ZoneId.of("Europe/Paris");
        LocalTime nineAm = LocalTime.of(9, 0);

        // Europe/Paris moves to summer time on 29 March 2026. Both mornings are 09:00 locally,
        // and they are different instants: 08:00Z in winter, 07:00Z in summer. Storing an instant
        // would make the business open an hour early for half the year.
        var beforeTheChange = LocalDate.of(2026, 3, 28).atTime(nineAm).atZone(paris).toInstant();
        var afterTheChange = LocalDate.of(2026, 3, 30).atTime(nineAm).atZone(paris).toInstant();

        assertThat(beforeTheChange.toString()).isEqualTo("2026-03-28T08:00:00Z");
        assertThat(afterTheChange.toString()).isEqualTo("2026-03-30T07:00:00Z");
    }

    private static WorkingHours hours(LocalTime start, LocalTime end) {
        return new WorkingHours(STAFF_ID, DayOfWeek.TUESDAY, start, end);
    }

    private static WorkingHours on(DayOfWeek day, String start, String end) {
        return new WorkingHours(STAFF_ID, day, LocalTime.parse(start), LocalTime.parse(end));
    }
}
