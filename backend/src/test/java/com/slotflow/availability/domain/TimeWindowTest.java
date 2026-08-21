package com.slotflow.availability.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * The half-open interval, tested harder than anything else in this codebase.
 *
 * <p>Every window here is drawn on one imaginary day so the relationships stay readable:
 * {@link #WORKDAY} is 09:00–17:00 and the others are named for where they sit against it. The
 * {@link Subtract} block is the reason this file exists — most availability bugs anywhere are a
 * wrong subtract, and there are exactly six positions {@code other} can occupy.
 */
class TimeWindowTest {

    private static final TimeWindow WORKDAY = window("09:00", "17:00");

    @Nested
    @DisplayName("construction")
    class Construction {

        @Test
        @DisplayName("a window must start strictly before it ends")
        void refusesAnEmptyWindow() {
            Instant nine = at("09:00");

            assertThatThrownBy(() -> new TimeWindow(nine, nine))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("strictly before");
        }

        @Test
        @DisplayName("a window may not run backwards")
        void refusesAReversedWindow() {
            assertThatThrownBy(() -> window("17:00", "09:00"))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("strictly before");
        }

        @Test
        @DisplayName("neither bound may be null")
        void refusesNullBounds() {
            assertThatThrownBy(() -> new TimeWindow(null, at("17:00")))
                    .isInstanceOf(IllegalArgumentException.class);
            assertThatThrownBy(() -> new TimeWindow(at("09:00"), null))
                    .isInstanceOf(IllegalArgumentException.class);
        }

        @Test
        @DisplayName("of(start, minutes) is the same window as spelling out both ends")
        void ofMinutes() {
            assertThat(TimeWindow.of(at("09:00"), 8 * 60)).isEqualTo(WORKDAY);
        }
    }

    // ---------------------------------------------------------------------------------
    //  the six positional relationships
    // ---------------------------------------------------------------------------------

    @Nested
    @DisplayName("subtract")
    class Subtract {

        @Test
        @DisplayName("1/6 other entirely before: the window survives whole")
        void otherBefore() {
            assertThat(WORKDAY.subtract(window("07:00", "08:00"))).containsExactly(WORKDAY);
        }

        @Test
        @DisplayName("2/6 other entirely after: the window survives whole")
        void otherAfter() {
            assertThat(WORKDAY.subtract(window("18:00", "19:00"))).containsExactly(WORKDAY);
        }

        @Test
        @DisplayName("3/6 other overlaps the left edge: the right-hand remainder is left")
        void otherOverlapsLeft() {
            assertThat(WORKDAY.subtract(window("08:00", "10:00")))
                    .containsExactly(window("10:00", "17:00"));
        }

        @Test
        @DisplayName("4/6 other overlaps the right edge: the left-hand remainder is left")
        void otherOverlapsRight() {
            assertThat(WORKDAY.subtract(window("16:00", "18:00")))
                    .containsExactly(window("09:00", "16:00"));
        }

        @Test
        @DisplayName("5/6 other strictly inside: the window splits in two")
        void otherStrictlyInside() {
            assertThat(WORKDAY.subtract(window("12:00", "13:00")))
                    .containsExactly(window("09:00", "12:00"), window("13:00", "17:00"));
        }

        @Test
        @DisplayName("6/6 other covers the window: nothing is left")
        void otherCovers() {
            assertThat(WORKDAY.subtract(window("08:00", "18:00"))).isEmpty();
        }

        @Test
        @DisplayName("an identical window covers it too, and leaves nothing")
        void identicalWindowLeavesNothing() {
            assertThat(WORKDAY.subtract(WORKDAY)).isEmpty();
        }

        @Test
        @DisplayName("touching at the start is disjoint: 08:00-09:00 removes nothing")
        void touchingAtTheStartRemovesNothing() {
            assertThat(WORKDAY.subtract(window("08:00", "09:00"))).containsExactly(WORKDAY);
        }

        @Test
        @DisplayName("touching at the end is disjoint: 17:00-18:00 removes nothing")
        void touchingAtTheEndRemovesNothing() {
            assertThat(WORKDAY.subtract(window("17:00", "18:00"))).containsExactly(WORKDAY);
        }

        @Test
        @DisplayName("a cut flush with the left edge does not leave a zero-length window behind")
        void flushWithTheLeftEdge() {
            assertThat(WORKDAY.subtract(window("09:00", "10:00")))
                    .containsExactly(window("10:00", "17:00"));
        }

        @Test
        @DisplayName("a cut flush with the right edge does not leave a zero-length window behind")
        void flushWithTheRightEdge() {
            assertThat(WORKDAY.subtract(window("16:00", "17:00")))
                    .containsExactly(window("09:00", "16:00"));
        }
    }

    @Nested
    @DisplayName("subtractAll")
    class SubtractAll {

        @Test
        @DisplayName("a split half faces the cuts that come after it")
        void splitHalvesAreCutAgain() {
            List<TimeWindow> left = TimeWindow.subtractAll(List.of(WORKDAY),
                    List.of(window("12:00", "13:00"), window("10:00", "11:00")));

            assertThat(left).containsExactly(
                    window("09:00", "10:00"), window("11:00", "12:00"), window("13:00", "17:00"));
        }

        @Test
        @DisplayName("no cuts leaves the windows exactly as they were")
        void noCutsChangesNothing() {
            assertThat(TimeWindow.subtractAll(List.of(WORKDAY), List.of())).containsExactly(WORKDAY);
        }

        @Test
        @DisplayName("a cut covering everything empties the list")
        void aCoveringCutEmptiesTheList() {
            assertThat(TimeWindow.subtractAll(
                    List.of(window("09:00", "12:00"), window("13:00", "17:00")),
                    List.of(window("08:00", "18:00"))))
                    .isEmpty();
        }
    }

    // ---------------------------------------------------------------------------------
    //  the rest of the algebra
    // ---------------------------------------------------------------------------------

    @Nested
    @DisplayName("predicates")
    class Predicates {

        @Test
        @DisplayName("windows that merely touch do not overlap")
        void touchingIsNotOverlapping() {
            assertThat(window("09:00", "10:00").overlaps(window("10:00", "11:00"))).isFalse();
            assertThat(window("10:00", "11:00").overlaps(window("09:00", "10:00"))).isFalse();
        }

        @Test
        @DisplayName("overlap is symmetric, and one shared minute is enough")
        void overlapIsSymmetric() {
            TimeWindow morning = window("09:00", "12:00");
            TimeWindow lunch = window("11:59", "13:00");

            assertThat(morning.overlaps(lunch)).isTrue();
            assertThat(lunch.overlaps(morning)).isTrue();
        }

        @Test
        @DisplayName("windows that touch abut, and disjoint ones do not")
        void abuts() {
            assertThat(window("09:00", "12:00").abuts(window("12:00", "17:00"))).isTrue();
            assertThat(window("09:00", "12:00").abuts(window("13:00", "17:00"))).isFalse();
        }

        @Test
        @DisplayName("the start instant is inside the window and the end instant is not")
        void containsIsHalfOpen() {
            assertThat(WORKDAY.contains(at("09:00"))).isTrue();
            assertThat(WORKDAY.contains(at("16:59"))).isTrue();
            assertThat(WORKDAY.contains(at("17:00"))).isFalse();
            assertThat(WORKDAY.contains(at("08:59"))).isFalse();
        }

        @Test
        @DisplayName("a window contains one that shares an edge with it, and itself")
        void containsAWindow() {
            assertThat(WORKDAY.contains(window("09:00", "17:00"))).isTrue();
            assertThat(WORKDAY.contains(window("09:00", "10:00"))).isTrue();
            assertThat(WORKDAY.contains(window("16:00", "17:00"))).isTrue();
            assertThat(WORKDAY.contains(window("08:00", "10:00"))).isFalse();
            assertThat(WORKDAY.contains(window("16:00", "18:00"))).isFalse();
        }
    }

    @Nested
    @DisplayName("intersect")
    class Intersect {

        @Test
        @DisplayName("the shared part of two overlapping windows")
        void sharedPart() {
            assertThat(WORKDAY.intersect(window("16:00", "20:00")))
                    .contains(window("16:00", "17:00"));
        }

        @Test
        @DisplayName("a contained window intersects to itself")
        void containedWindow() {
            assertThat(WORKDAY.intersect(window("12:00", "13:00")))
                    .contains(window("12:00", "13:00"));
        }

        @Test
        @DisplayName("touching windows share nothing, so there is no zero-length result")
        void touchingWindowsShareNothing() {
            assertThat(window("09:00", "12:00").intersect(window("12:00", "17:00")))
                    .isEqualTo(Optional.empty());
        }

        @Test
        @DisplayName("disjoint windows share nothing")
        void disjointWindowsShareNothing() {
            assertThat(WORKDAY.intersect(window("20:00", "21:00"))).isEmpty();
        }
    }

    @Nested
    @DisplayName("merge")
    class Merge {

        @Test
        @DisplayName("overlapping windows merge to their union")
        void overlappingWindowsMerge() {
            assertThat(window("09:00", "12:00").merge(window("11:00", "17:00")))
                    .contains(WORKDAY);
        }

        @Test
        @DisplayName("touching windows merge, which is what makes a gapless split shift one window")
        void touchingWindowsMerge() {
            assertThat(window("09:00", "12:00").merge(window("12:00", "17:00")))
                    .contains(WORKDAY);
        }

        @Test
        @DisplayName("a contained window merges to the container")
        void containedWindowMerges() {
            assertThat(WORKDAY.merge(window("12:00", "13:00"))).contains(WORKDAY);
        }

        @Test
        @DisplayName("disjoint windows do not merge: the hull would open hours nobody works")
        void disjointWindowsDoNotMerge() {
            assertThat(window("09:00", "10:00").merge(window("14:00", "15:00"))).isEmpty();
        }
    }

    @Nested
    @DisplayName("normalize")
    class Normalize {

        @Test
        @DisplayName("sorts by start")
        void sortsByStart() {
            assertThat(TimeWindow.normalize(
                    List.of(window("14:00", "15:00"), window("09:00", "10:00"))))
                    .containsExactly(window("09:00", "10:00"), window("14:00", "15:00"));
        }

        @Test
        @DisplayName("coalesces windows that touch, so a gapless split shift becomes one window")
        void coalescesTouchingWindows() {
            assertThat(TimeWindow.normalize(
                    List.of(window("12:00", "17:00"), window("09:00", "12:00"))))
                    .containsExactly(WORKDAY);
        }

        @Test
        @DisplayName("coalesces a chain of overlaps into one window")
        void coalescesAChain() {
            assertThat(TimeWindow.normalize(List.of(
                    window("09:00", "11:00"), window("10:00", "13:00"), window("12:00", "17:00"))))
                    .containsExactly(WORKDAY);
        }

        @Test
        @DisplayName("swallows a window entirely inside another")
        void swallowsAContainedWindow() {
            assertThat(TimeWindow.normalize(List.of(WORKDAY, window("12:00", "13:00"))))
                    .containsExactly(WORKDAY);
        }

        @Test
        @DisplayName("leaves a real gap alone: the lunch break survives")
        void keepsARealGap() {
            assertThat(TimeWindow.normalize(
                    List.of(window("13:00", "17:00"), window("09:00", "12:00"))))
                    .containsExactly(window("09:00", "12:00"), window("13:00", "17:00"));
        }

        @Test
        @DisplayName("an empty list and a single window come back unchanged")
        void trivialInputs() {
            assertThat(TimeWindow.normalize(List.of())).isEmpty();
            assertThat(TimeWindow.normalize(List.of(WORKDAY))).containsExactly(WORKDAY);
        }
    }

    @Nested
    @DisplayName("measurement and ordering")
    class Measurement {

        @Test
        @DisplayName("duration is elapsed minutes")
        void durationInMinutes() {
            assertThat(WORKDAY.durationMinutes()).isEqualTo(8 * 60);
            assertThat(window("09:00", "09:45").durationMinutes()).isEqualTo(45);
        }

        @Test
        @DisplayName("duration counts real elapsed time, not the wall clock it is drawn on")
        void durationIsElapsedNotWallClock() {
            // Europe/Paris, 29 March 2026: 02:00 local never happens. A 01:00-05:00 shift is three
            // hours of work, and every DST case in the engine turns on this being three and not four.
            TimeWindow springForwardShift = new TimeWindow(
                    Instant.parse("2026-03-29T00:00:00Z"), Instant.parse("2026-03-29T03:00:00Z"));

            assertThat(springForwardShift.durationMinutes()).isEqualTo(3 * 60);
        }

        @Test
        @DisplayName("windows sort by start, then by end")
        void ordering() {
            assertThat(window("09:00", "10:00")).isLessThan(window("09:00", "11:00"));
            assertThat(window("10:00", "11:00")).isGreaterThan(window("09:00", "23:00"));
            assertThat(WORKDAY).isEqualByComparingTo(window("09:00", "17:00"));
        }

        @Test
        @DisplayName("toString shows the half-open bracket, so a failure message says which end is open")
        void toStringShowsTheConvention() {
            assertThat(WORKDAY).hasToString("[2026-03-02T09:00:00Z, 2026-03-02T17:00:00Z)");
        }
    }

    // ---------------------------------------------------------------------------------

    private static TimeWindow window(String from, String to) {
        return new TimeWindow(at(from), at(to));
    }

    /** A time on {@code TestTime.NOW}'s Monday, in UTC — this class is about the algebra, not zones. */
    private static Instant at(String localTime) {
        return Instant.parse("2026-03-02T" + localTime + ":00Z");
    }
}
