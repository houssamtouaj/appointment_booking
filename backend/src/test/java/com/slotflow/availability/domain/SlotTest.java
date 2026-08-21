package com.slotflow.availability.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The guards on a slot, which exist so that a wrong one cannot reach a response.
 *
 * <p>Small, and worth having: every one of these is a shape the engine could produce from a bug
 * upstream — an empty candidate list from a dedupe that lost its key, a backwards window from a
 * duration subtracted rather than added — and each would otherwise be discovered by a client.
 */
class SlotTest {

    private static final Instant NINE = Instant.parse("2026-03-02T09:00:00Z");
    private static final UUID DANA = UUID.fromString("00000000-0000-0000-0000-0000000000d0");
    private static final UUID SAM = UUID.fromString("00000000-0000-0000-0000-0000000000a5");

    @Test
    @DisplayName("of(start, duration, staff) is the window the customer sees")
    void ofDuration() {
        Slot slot = Slot.of(NINE, 45, List.of(DANA));

        assertThat(slot.end()).isEqualTo(Instant.parse("2026-03-02T09:45:00Z"));
        assertThat(slot.window())
                .isEqualTo(new TimeWindow(NINE, Instant.parse("2026-03-02T09:45:00Z")));
    }

    @Test
    @DisplayName("candidate staff are sorted and copied, so the response cannot shuffle between runs")
    void staffIdsAreSortedAndCopied() {
        List<UUID> mutable = new java.util.ArrayList<>(List.of(DANA, SAM));
        Slot slot = new Slot(NINE, NINE.plusSeconds(3600), mutable);

        assertThat(slot.staffIds()).containsExactly(SAM, DANA).isSorted();
        mutable.clear();
        assertThat(slot.staffIds()).hasSize(2);
    }

    @Test
    @DisplayName("a slot nobody can serve is not a slot")
    void refusesAnEmptyCandidateList() {
        assertThatThrownBy(() -> new Slot(NINE, NINE.plusSeconds(3600), List.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("nobody can serve");
        assertThatThrownBy(() -> new Slot(NINE, NINE.plusSeconds(3600), null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("a slot must start strictly before it ends, and may not be missing an end")
    void refusesADegenerateWindow() {
        assertThatThrownBy(() -> new Slot(NINE, NINE, List.of(DANA)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("strictly before");
        assertThatThrownBy(() -> new Slot(NINE, null, List.of(DANA)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Slot(null, NINE, List.of(DANA)))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
