package com.slotflow.availability;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The two invariants the schema encodes, checked in Java so a bad override cannot even be built:
 * both times are set or neither is, and a whole-day {@code EXTRA} does not exist.
 */
class AvailabilityOverrideTest {

    private static final UUID BUSINESS_ID = UUID.randomUUID();
    private static final UUID STAFF_ID = UUID.randomUUID();
    private static final LocalDate CHRISTMAS = LocalDate.of(2026, 12, 25);

    @Test
    @DisplayName("a whole-day block is a day off for one staff member")
    void wholeDayBlock() {
        AvailabilityOverride override =
                AvailabilityOverride.blockedDay(BUSINESS_ID, STAFF_ID, CHRISTMAS, "Annual leave");

        assertThat(override.isWholeDay()).isTrue();
        assertThat(override.isBlocked()).isTrue();
        assertThat(override.isBusinessWide()).isFalse();
        assertThat(override.getStartTime()).isNull();
        assertThat(override.getEndTime()).isNull();
    }

    @Test
    @DisplayName("a business-wide closure has no staff id, so it cannot drift as staff change (D5)")
    void businessWideClosure() {
        AvailabilityOverride closure =
                AvailabilityOverride.businessWideClosure(BUSINESS_ID, CHRISTMAS, "Closed");

        // One row rather than one per staff member. The alternative silently stops covering
        // anybody hired after the closure was entered.
        assertThat(closure.isBusinessWide()).isTrue();
        assertThat(closure.getStaffId()).isNull();
        assertThat(closure.isWholeDayClosure()).isTrue();
    }

    @Test
    @DisplayName("a partial block keeps its range")
    void partialBlock() {
        AvailabilityOverride override = AvailabilityOverride.blockedRange(
                BUSINESS_ID, STAFF_ID, CHRISTMAS, LocalTime.of(12, 0), LocalTime.of(14, 0), "Dentist");

        assertThat(override.isWholeDay()).isFalse();
        assertThat(override.isWholeDayClosure()).isFalse();
        assertThat(override.getStartTime()).isEqualTo(LocalTime.of(12, 0));
    }

    @Test
    @DisplayName("extra hours are always a range, and are not a block")
    void extraHours() {
        AvailabilityOverride override = AvailabilityOverride.extraHours(
                BUSINESS_ID, STAFF_ID, CHRISTMAS, LocalTime.of(18, 0), LocalTime.of(20, 0), "Late night");

        assertThat(override.isExtra()).isTrue();
        assertThat(override.isBlocked()).isFalse();
        assertThat(override.isWholeDay()).isFalse();
    }

    @Test
    @DisplayName("a whole-day EXTRA is refused: it says nothing at all")
    void wholeDayExtraIsRefused() {
        AvailabilityOverride extra = AvailabilityOverride.extraHours(
                BUSINESS_ID, STAFF_ID, CHRISTMAS, LocalTime.of(18, 0), LocalTime.of(20, 0), null);

        // "Available all day" is not a statement about availability — the weekly template already
        // says when this person works. Plan 08 answers the request with a 422.
        assertThatThrownBy(() -> extra.setTimes(null, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("no meaning");
    }

    @Test
    @DisplayName("one time without the other is refused: it is a bug, never a meaning")
    void halfARangeIsRefused() {
        AvailabilityOverride override =
                AvailabilityOverride.blockedDay(BUSINESS_ID, STAFF_ID, CHRISTMAS, null);

        assertThatThrownBy(() -> override.setTimes(LocalTime.of(9, 0), null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> override.setTimes(null, LocalTime.of(9, 0)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("a zero-length range is refused")
    void zeroLengthRangeIsRefused() {
        assertThatThrownBy(() -> AvailabilityOverride.blockedRange(
                BUSINESS_ID, STAFF_ID, CHRISTMAS, LocalTime.NOON, LocalTime.NOON, null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("extra hours require both times up front")
    void extraHoursRequireARange() {
        assertThatThrownBy(() -> AvailabilityOverride.extraHours(
                BUSINESS_ID, STAFF_ID, CHRISTMAS, null, null, null))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
