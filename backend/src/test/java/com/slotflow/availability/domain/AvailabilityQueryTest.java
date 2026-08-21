package com.slotflow.availability.domain;

import static com.slotflow.support.fixtures.Fixtures.workingHours;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.slotflow.availability.domain.AvailabilityQuery.StaffSchedule;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The pure-domain boundary's own guards.
 *
 * <p>A query that cannot be built wrong is what lets {@link AvailabilityEngine} contain no defensive
 * checks at all: every field it reads has already been proved present and sane here, once, at the
 * edge. The two collection copies are the same argument in a different key — the engine folds over
 * these lists repeatedly, and a caller mutating one mid-fold would be a bug with no stack trace.
 */
class AvailabilityQueryTest {

    private static final ZoneId PARIS = ZoneId.of("Europe/Paris");
    private static final LocalDate MONDAY = LocalDate.of(2026, 3, 2);
    private static final UUID DANA = UUID.randomUUID();

    @Test
    @DisplayName("the block a slot costs is the duration plus both buffers")
    void totalBlockMinutes() {
        assertThat(query().totalBlockMinutes()).isEqualTo(60);
        assertThat(aQuery(60, 10, 15).totalBlockMinutes()).isEqualTo(85);
    }

    @Test
    @DisplayName("a zero or negative duration and a zero granularity are refused")
    void refusesImpossibleShapes() {
        assertThatThrownBy(() -> aQuery(0, 0, 0))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("durationMinutes");
        assertThatThrownBy(() -> new AvailabilityQuery(PARIS, range(), 60, 0, 0, 0,
                Instant.MIN, Instant.MAX, List.of(), List.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("slotGranularityMinutes");
        assertThatThrownBy(() -> aQuery(60, -1, 0))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("bufferBeforeMinutes");
        assertThatThrownBy(() -> aQuery(60, 0, -1))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("bufferAfterMinutes");
    }

    @Test
    @DisplayName("nothing the engine reads may be null")
    void refusesMissingFields() {
        assertThatThrownBy(() -> new AvailabilityQuery(null, range(), 60, 0, 0, 30,
                Instant.MIN, Instant.MAX, List.of(), List.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("businessZone");
        assertThatThrownBy(() -> new AvailabilityQuery(PARIS, null, 60, 0, 0, 30,
                Instant.MIN, Instant.MAX, List.of(), List.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("range");
        assertThatThrownBy(() -> new AvailabilityQuery(PARIS, range(), 60, 0, 0, 30,
                null, Instant.MAX, List.of(), List.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("earliestStart");
        assertThatThrownBy(() -> new AvailabilityQuery(PARIS, range(), 60, 0, 0, 30,
                Instant.MIN, null, List.of(), List.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("latestStart");
        assertThatThrownBy(() -> new AvailabilityQuery(PARIS, range(), 60, 0, 0, 30,
                Instant.MIN, Instant.MAX, null, List.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("businessWide");
        assertThatThrownBy(() -> new AvailabilityQuery(PARIS, range(), 60, 0, 0, 30,
                Instant.MIN, Instant.MAX, List.of(), null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("staff");
    }

    @Test
    @DisplayName("a schedule copies its three lists, so a caller cannot change them mid-fold")
    void staffScheduleCopiesItsLists() {
        List<com.slotflow.availability.WorkingHours> template = new ArrayList<>(
                List.of(workingHours().forStaff(DANA).on(DayOfWeek.MONDAY).build()));
        StaffSchedule schedule = StaffSchedule.of(DANA, template);

        template.clear();
        assertThat(schedule.workingHours()).hasSize(1);
        assertThat(schedule.overrides()).isEmpty();
        assertThat(schedule.busy()).isEmpty();
    }

    @Test
    @DisplayName("a schedule needs a staff id and three lists, even empty ones")
    void staffScheduleRefusesMissingFields() {
        assertThatThrownBy(() -> new StaffSchedule(null, List.of(), List.of(), List.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("staffId");
        assertThatThrownBy(() -> new StaffSchedule(DANA, null, List.of(), List.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("workingHours");
        assertThatThrownBy(() -> new StaffSchedule(DANA, List.of(), null, List.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("overrides");
        assertThatThrownBy(() -> new StaffSchedule(DANA, List.of(), List.of(), null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("busy");
    }

    // ---------------------------------------------------------------------------------

    private static AvailabilityQuery query() {
        return aQuery(60, 0, 0);
    }

    private static AvailabilityQuery aQuery(int duration, int before, int after) {
        return new AvailabilityQuery(PARIS, range(), duration, before, after, 30,
                Instant.MIN, Instant.MAX, List.of(), List.of());
    }

    private static TimeWindow range() {
        return new TimeWindow(MONDAY.atStartOfDay(PARIS).toInstant(),
                MONDAY.plusDays(1).atStartOfDay(PARIS).toInstant());
    }
}
