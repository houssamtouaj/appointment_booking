package com.slotflow.availability;

import static com.slotflow.support.fixtures.Fixtures.workingHours;
import static org.assertj.core.api.Assertions.assertThat;

import com.slotflow.support.fixtures.WorkingHoursBuilder;
import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The hull the public business page shows (D5), as a pure function.
 *
 * <p>No Spring, no database and no clock, because every case worth arguing about is a shape of
 * input: a split shift, two people whose hours barely overlap, a night shift, nobody working at all.
 */
class OpeningHoursTest {

    private final UUID dana = UUID.randomUUID();
    private final UUID sam = UUID.randomUUID();

    @Test
    @DisplayName("a split shift reports one window from the earliest start to the latest end")
    void aSplitShiftIsOneWindow() {
        List<OpeningHours> week = OpeningHours.derive(all(
                workingHours().forStaff(dana).on(DayOfWeek.MONDAY).from("09:00").to("12:00"),
                workingHours().forStaff(dana).on(DayOfWeek.MONDAY).from("13:00").to("17:00")));

        // 09:00–17:00, lunch included. A hull, not a schedule: whether 12:30 is bookable is the
        // engine's answer, and the landing page is answering "are you open today".
        assertThat(week).singleElement().satisfies(monday -> {
            assertThat(monday.dayOfWeek()).isEqualTo(DayOfWeek.MONDAY);
            assertThat(monday.opensAt()).isEqualTo(LocalTime.of(9, 0));
            assertThat(monday.closesAt()).isEqualTo(LocalTime.of(17, 0));
            assertThat(monday.closesNextDay()).isFalse();
        });
    }

    @Test
    @DisplayName("the union spans the whole team, not the first row found")
    void theUnionSpansTheTeam() {
        List<OpeningHours> week = OpeningHours.derive(all(
                workingHours().forStaff(dana).on(DayOfWeek.TUESDAY).from("10:00").to("16:00"),
                workingHours().forStaff(sam).on(DayOfWeek.TUESDAY).from("08:30").to("18:15")));

        assertThat(week).singleElement().satisfies(tuesday -> {
            assertThat(tuesday.opensAt()).isEqualTo(LocalTime.of(8, 30));
            assertThat(tuesday.closesAt()).isEqualTo(LocalTime.of(18, 15));
        });
    }

    @Test
    @DisplayName("a night shift closes on the following date")
    void aNightShiftClosesNextDay() {
        List<OpeningHours> week = OpeningHours.derive(all(
                workingHours().forStaff(dana).on(DayOfWeek.FRIDAY).from("22:00").to("02:00")));

        assertThat(week).singleElement().satisfies(friday -> {
            assertThat(friday.opensAt()).isEqualTo(LocalTime.of(22, 0));
            assertThat(friday.closesAt()).isEqualTo(LocalTime.of(2, 0));
            assertThat(friday.closesNextDay()).isTrue();
        });
    }

    @Test
    @DisplayName("a shift ending at 02:00 counts as later than one ending at 23:00")
    void midnightCrossingWinsTheLatestEnd() {
        List<OpeningHours> week = OpeningHours.derive(all(
                workingHours().forStaff(dana).on(DayOfWeek.SATURDAY).from("18:00").to("23:00"),
                workingHours().forStaff(sam).on(DayOfWeek.SATURDAY).from("20:00").to("02:00")));

        // The comparison is in minutes from midnight, not on LocalTime: 02:00 is before 23:00 as a
        // wall-clock time and four hours after it as a moment, and only the second reading closes
        // the bar at the right time.
        assertThat(week).singleElement().satisfies(saturday -> {
            assertThat(saturday.opensAt()).isEqualTo(LocalTime.of(18, 0));
            assertThat(saturday.closesAt()).isEqualTo(LocalTime.of(2, 0));
            assertThat(saturday.closesNextDay()).isTrue();
        });
    }

    @Test
    @DisplayName("a shift ending exactly at midnight closes the next day at 00:00")
    void midnightItselfIsTheNextDay() {
        List<OpeningHours> week = OpeningHours.derive(all(
                workingHours().forStaff(dana).on(DayOfWeek.WEDNESDAY).from("16:00").to("00:00")));

        assertThat(week).singleElement().satisfies(wednesday -> {
            assertThat(wednesday.closesAt()).isEqualTo(LocalTime.MIDNIGHT);
            assertThat(wednesday.closesNextDay()).isTrue();
        });
    }

    @Test
    @DisplayName("days nobody works are absent, and the rest come back Monday first")
    void theWeekIsOrderedAndSparse() {
        List<OpeningHours> week = OpeningHours.derive(all(
                workingHours().forStaff(dana).on(DayOfWeek.SATURDAY).from("10:00").to("14:00"),
                workingHours().forStaff(dana).on(DayOfWeek.TUESDAY).from("09:00").to("17:00")));

        // Absent rather than present with nulls: "closed on Sunday" and "no hours configured yet"
        // are the same fact to a landing page, and Monday-first is the order the grid is drawn in.
        assertThat(week).extracting(OpeningHours::dayOfWeek)
                .containsExactly(DayOfWeek.TUESDAY, DayOfWeek.SATURDAY);
    }

    @Test
    @DisplayName("no working hours at all is an empty list")
    void noHoursIsEmpty() {
        assertThat(OpeningHours.derive(List.of())).isEmpty();
    }

    private static List<WorkingHours> all(WorkingHoursBuilder... builders) {
        List<WorkingHours> rows = new ArrayList<>();
        for (var builder : builders) {
            rows.add(builder.build());
        }
        return rows;
    }
}
