package com.slotflow.availability;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
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
}
