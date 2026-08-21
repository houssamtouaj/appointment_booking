package com.slotflow.availability.domain;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * A half-open interval of instants, {@code [start, end)}, and the whole engine's vocabulary.
 *
 * <h2>Half-open is not a detail</h2>
 * It is the single decision that makes a 09:00–10:00 booking and a 10:00–11:00 booking
 * non-overlapping, and it is the same convention as the {@code tstzrange} the exclusion constraint
 * ranges over (plan 02) and the working-hours overlap check (plan 08). If this class closed its
 * upper bound the engine would refuse the slot the database happily accepts, at exactly the
 * boundary case plan 10 tests — so the convention is stated once, here, and everything else folds
 * over these operations rather than comparing instants by hand.
 *
 * <h2>Empty windows are not representable</h2>
 * {@code start} must be strictly before {@code end}. A zero-length window would satisfy
 * {@code contains} for nothing and {@code overlaps} with nothing, so it can only ever be a bug that
 * survives one more step than it should — {@link #subtract} and {@link #intersect} therefore return
 * a list and an {@code Optional} rather than a degenerate window.
 *
 * @param start inclusive
 * @param end   exclusive
 */
public record TimeWindow(Instant start, Instant end) implements Comparable<TimeWindow> {

    public TimeWindow {
        if (start == null || end == null) {
            throw new IllegalArgumentException("a time window needs both a start and an end");
        }
        if (!start.isBefore(end)) {
            throw new IllegalArgumentException(
                    "a time window must start strictly before it ends: " + start + " to " + end);
        }
    }

    /** {@code [start, start + minutes)}. */
    public static TimeWindow of(Instant start, long minutes) {
        return new TimeWindow(start, start.plusSeconds(minutes * 60L));
    }

    // ---------------------------------------------------------------------------------
    //  predicates
    // ---------------------------------------------------------------------------------

    /**
     * True when the two share at least one instant. Windows that merely touch — one ending exactly
     * where the next begins — do not overlap, which is the whole point of the half-open convention.
     */
    public boolean overlaps(TimeWindow other) {
        return start.isBefore(other.end) && other.start.isBefore(end);
    }

    /** True when the two touch or overlap, so that their union is itself one window. */
    public boolean abuts(TimeWindow other) {
        return !start.isAfter(other.end) && !other.start.isAfter(end);
    }

    public boolean contains(Instant instant) {
        return !instant.isBefore(start) && instant.isBefore(end);
    }

    /** True when {@code other} lies entirely inside this window, edges included. */
    public boolean contains(TimeWindow other) {
        return !other.start.isBefore(start) && !other.end.isAfter(end);
    }

    // ---------------------------------------------------------------------------------
    //  algebra
    // ---------------------------------------------------------------------------------

    /**
     * What is left of this window once {@code other} is taken out of it: zero, one or two windows.
     *
     * <p><b>Over-tested on purpose.</b> Most availability bugs anywhere are a wrong subtract, and
     * this one method is how a booking, a blocked override and a business-wide closure all remove
     * time. The six positional relationships it has to get right, with {@code this} drawn as
     * {@code |---|}:
     *
     * <pre>
     *   other before        [--]  |---|      → this, untouched
     *   other after               |---|  [--] → this, untouched
     *   other overlaps left    [--|-]  |      → one window, the right-hand remainder
     *   other overlaps right   |  [-|--]      → one window, the left-hand remainder
     *   other strictly inside  | [--]  |      → two windows, one either side
     *   other covers          [|------|]      → nothing at all
     * </pre>
     *
     * <p>Touching counts as disjoint, again: subtracting {@code [10:00, 11:00)} from
     * {@code [09:00, 10:00)} leaves the latter whole.
     */
    public List<TimeWindow> subtract(TimeWindow other) {
        if (!overlaps(other)) {
            return List.of(this);
        }
        boolean leftRemains = start.isBefore(other.start);
        boolean rightRemains = other.end.isBefore(end);
        if (leftRemains && rightRemains) {
            return List.of(new TimeWindow(start, other.start), new TimeWindow(other.end, end));
        }
        if (leftRemains) {
            return List.of(new TimeWindow(start, other.start));
        }
        if (rightRemains) {
            return List.of(new TimeWindow(other.end, end));
        }
        return List.of();
    }

    /**
     * Every window in {@code windows} with every window in {@code cuts} taken out of it.
     *
     * <p>The fold the pipeline actually performs — a day's working hours minus the closures minus
     * the bookings — written once so that no caller has to remember that a subtraction can split a
     * window and that the split halves must themselves face the remaining cuts.
     */
    public static List<TimeWindow> subtractAll(List<TimeWindow> windows, List<TimeWindow> cuts) {
        List<TimeWindow> remaining = new ArrayList<>(windows);
        for (TimeWindow cut : cuts) {
            List<TimeWindow> next = new ArrayList<>(remaining.size() + 1);
            for (TimeWindow window : remaining) {
                next.addAll(window.subtract(cut));
            }
            remaining = next;
        }
        return List.copyOf(remaining);
    }

    /** The instants the two have in common, or empty when they only touch or miss entirely. */
    public Optional<TimeWindow> intersect(TimeWindow other) {
        if (!overlaps(other)) {
            return Optional.empty();
        }
        Instant from = start.isAfter(other.start) ? start : other.start;
        Instant to = end.isBefore(other.end) ? end : other.end;
        return Optional.of(new TimeWindow(from, to));
    }

    /**
     * The union of two windows that touch or overlap, or empty when they are disjoint.
     *
     * <p>An {@code Optional} rather than the convex hull, because the union of {@code [09:00,
     * 10:00)} and {@code [14:00, 15:00)} is not a window and returning {@code [09:00, 15:00)} would
     * quietly open five hours nobody works. {@link #normalize} is the caller that wants this in
     * bulk.
     */
    public Optional<TimeWindow> merge(TimeWindow other) {
        if (!abuts(other)) {
            return Optional.empty();
        }
        Instant from = start.isBefore(other.start) ? start : other.start;
        Instant to = end.isAfter(other.end) ? end : other.end;
        return Optional.of(new TimeWindow(from, to));
    }

    /**
     * The same set of instants as a sorted list of disjoint, non-touching windows.
     *
     * <p>Windows that touch are coalesced, not merely sorted: a split shift saved as 09:00–12:00
     * and 12:00–17:00 is eight unbroken hours, and leaving it as two windows would lose every slot
     * that straddles noon. That is also why {@link #abuts} and not {@link #overlaps} decides.
     */
    public static List<TimeWindow> normalize(List<TimeWindow> windows) {
        if (windows.size() < 2) {
            return List.copyOf(windows);
        }
        List<TimeWindow> sorted = new ArrayList<>(windows);
        sorted.sort(Comparator.naturalOrder());

        List<TimeWindow> merged = new ArrayList<>(sorted.size());
        TimeWindow open = sorted.getFirst();
        for (TimeWindow next : sorted.subList(1, sorted.size())) {
            Optional<TimeWindow> union = open.merge(next);
            if (union.isPresent()) {
                open = union.get();
            } else {
                merged.add(open);
                open = next;
            }
        }
        merged.add(open);
        return List.copyOf(merged);
    }

    // ---------------------------------------------------------------------------------
    //  measurement
    // ---------------------------------------------------------------------------------

    /**
     * Elapsed minutes, truncated. A real elapsed count and not a wall-clock difference: the
     * spring-forward day's 01:00–05:00 shift is three hours long, and every DST case in this engine
     * turns on that being true.
     */
    public long durationMinutes() {
        return Duration.between(start, end).toMinutes();
    }

    /** Sorted by start, then by end, so {@link #normalize} can coalesce in one pass. */
    @Override
    public int compareTo(TimeWindow other) {
        int byStart = start.compareTo(other.start);
        return byStart != 0 ? byStart : end.compareTo(other.end);
    }

    @Override
    public String toString() {
        return "[" + start + ", " + end + ")";
    }
}
