package com.slotflow.booking;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/**
 * Two predicates on five statuses, and both of them are load-bearing somewhere a mistake would be
 * quiet.
 *
 * <p>{@link BookingStatus#blocking()} is the set the database's {@code booking_no_overlap}
 * constraint filters on. Java and SQL each hold their own copy of that list — one as an
 * {@code EnumSet}, one as a {@code WHERE status IN (...)} — and they cannot be derived from each
 * other, so the only defence is that both are written down and one of them is asserted. Adding a
 * sixth status and forgetting this set means the availability engine offers a slot the constraint
 * will refuse, which surfaces as a 409 on a slot the API had just advertised.
 *
 * <p>{@link BookingStatus#isTerminal()} is the other half: whether a booking can still move. It is
 * <em>not</em> the complement of {@code isActive()}, and the gap between them is the reason this is
 * worth a test rather than a glance — {@code NO_SHOW} is neither, because it occupies no slot and
 * can still be corrected to {@code CANCELLED} or {@code COMPLETED} by an owner who pressed the
 * wrong button.
 */
class BookingStatusTest {

    @ParameterizedTest(name = "{0}: occupies a slot {1}, final {2}")
    @CsvSource({
            "PENDING,   true,  false",
            "CONFIRMED, true,  false",
            "CANCELLED, false, true",
            "COMPLETED, false, true",
            // The one row worth reading twice: it holds no slot and is not the end of the story.
            "NO_SHOW,   false, false",
    })
    void eachStatusKnowsWhetherItHoldsASlotAndWhetherItIsFinal(
            BookingStatus status, boolean active, boolean terminal) {
        assertThat(status.isActive()).isEqualTo(active);
        assertThat(status.isTerminal()).isEqualTo(terminal);
    }

    @Test
    @DisplayName("the blocking set is exactly what the exclusion constraint's WHERE clause lists")
    void theBlockingSetMatchesTheSchema() {
        // Transcribed from V1's `WHERE (status IN ('PENDING', 'CONFIRMED'))`, not imported from it.
        // A test that derived this from the same constant it is checking would pass whatever the
        // constant said.
        assertThat(BookingStatus.blocking())
                .containsExactlyInAnyOrder(BookingStatus.PENDING, BookingStatus.CONFIRMED);
    }
}
