package com.slotflow.availability;

import com.slotflow.common.jpa.AbstractMutableEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * One range of a staff member's weekly recurring availability.
 *
 * <h2>Local times, on purpose</h2>
 * {@code LocalTime} and not {@code Instant}: "we open at nine" is a wall-clock statement that
 * stays true across a DST boundary. Storing an instant would mean the salon opened at 09:00 in
 * winter and 08:00 in summer, and every autumn somebody would file a bug. The engine materialises
 * these into instants per date, in the <em>business</em> timezone (plan 09).
 *
 * <h2>A set per weekday, not a row per weekday</h2>
 * Split shifts are ordinary — 09:00–12:00 and 13:00–17:00 is most of hospitality — so
 * {@code (staff_id, day_of_week)} is deliberately not unique. Modelling one row per day would make
 * the lunch break impossible to express and the migration to fix it painful.
 *
 * <h2>{@code endTime < startTime} means midnight</h2>
 * A 22:00–02:00 range is a real night shift, so it is legal and {@link #crossesMidnight} is how
 * the engine finds out. Only {@code endTime == startTime} is meaningless, and the schema rejects
 * it.
 */
@Entity
@Table(name = "working_hours")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class WorkingHours extends AbstractMutableEntity {

    @Column(nullable = false, updatable = false)
    private UUID staffId;

    /**
     * The {@code java.time.DayOfWeek} name, not the brief's 0–6 (D16). The brief numbers from
     * Sunday and {@code DayOfWeek} from Monday at 1, so storing the name removes an off-by-one
     * that would otherwise live in two translation layers forever.
     */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 9)
    private DayOfWeek dayOfWeek;

    @Column(nullable = false)
    private LocalTime startTime;

    @Column(nullable = false)
    private LocalTime endTime;

    public WorkingHours(UUID staffId, DayOfWeek dayOfWeek, LocalTime startTime, LocalTime endTime) {
        this.staffId = requireNotNull(staffId, "staffId");
        this.dayOfWeek = requireNotNull(dayOfWeek, "dayOfWeek");
        setRange(startTime, endTime);
    }

    /** True for a shift that ends on the following date, such as 22:00–02:00. */
    public boolean crossesMidnight() {
        return endTime.isBefore(startTime);
    }

    /**
     * Where the shift starts, as minutes since midnight.
     *
     * <p>Minutes rather than a {@code LocalTime} because every comparison this feeds has to treat a
     * shift that ends at 02:00 as later than one that ends at 23:00, and no comparison of two
     * wall-clock times can do that. Paired with {@link #durationMinutes()} it turns a range into a
     * half-open interval, which is the only shape that reasons about midnight correctly — see
     * {@link OpeningHours#derive} and the overlap check in plan 08.
     */
    public int startMinuteOfDay() {
        return startTime.toSecondOfDay() / 60;
    }

    /**
     * How long the shift lasts, in minutes, counting a midnight crossing correctly. Useful for the
     * derived opening hours on the public business page (plan 07) and for asserting that a service
     * cannot possibly fit.
     */
    public int durationMinutes() {
        int start = startMinuteOfDay();
        int end = endTime.toSecondOfDay() / 60;
        return crossesMidnight() ? (24 * 60 - start) + end : end - start;
    }

    // ---------------------------------------------------------------------------------
    //  the overlap rule
    // ---------------------------------------------------------------------------------

    private static final int MINUTES_PER_DAY = 24 * 60;
    private static final int MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

    /**
     * The first weekday whose ranges overlap something, or empty when the whole template is
     * consistent. Plan 08 turns a non-empty answer into {@code 422 HOURS_OVERLAP}.
     *
     * <p><b>Across the week, not within a day.</b> The plan asks only that ranges within one day do
     * not overlap, and that is the case a client hits — two rows of the same grid line. But the same
     * mistake is expressible across midnight: a Monday 22:00–02:00 shift and a Tuesday 01:00–03:00
     * shift do not share a weekday and do overlap in reality, on Tuesday morning, and storing both
     * would hand the engine two answers about whether that hour is worked. Laying the week out as
     * minutes from Monday midnight — with a shift that runs past Sunday midnight wrapping to Monday —
     * makes the two cases one check, and one error code, rather than a second rule somebody has to
     * remember exists.
     *
     * <p>Half-open intervals throughout, so a shift that ends at 12:00 and one that starts at 12:00
     * are adjacent rather than overlapping. That matches the {@code tstzrange} the booking
     * constraint uses, and it is what makes a split shift with no gap expressible at all.
     */
    public static Optional<DayOfWeek> findOverlap(Collection<WorkingHours> ranges) {
        List<Span> spans = new ArrayList<>(ranges.size() + 1);
        for (WorkingHours range : ranges) {
            int from = range.getDayOfWeek().ordinal() * MINUTES_PER_DAY + range.startMinuteOfDay();
            int to = from + range.durationMinutes();
            if (to <= MINUTES_PER_WEEK) {
                spans.add(new Span(range.getDayOfWeek(), from, to));
            } else {
                // A Sunday night shift finishes on Monday morning, which is earlier in this
                // coordinate system than it started. Two pieces, so the comparison stays a plain
                // sort instead of modular arithmetic at every step.
                spans.add(new Span(range.getDayOfWeek(), from, MINUTES_PER_WEEK));
                spans.add(new Span(range.getDayOfWeek(), 0, to - MINUTES_PER_WEEK));
            }
        }

        spans.sort(Comparator.comparingInt(Span::from));
        for (int i = 1; i < spans.size(); i++) {
            // Sorted by start, so if any two spans overlap then some adjacent pair does: the later
            // of an overlapping pair starts before the earlier one ends, and anything sorted between
            // them starts before that too.
            if (spans.get(i).from() < spans.get(i - 1).to()) {
                // The day of the range that starts second, which is the row the editor just added.
                return Optional.of(spans.get(i).day());
            }
        }
        return Optional.empty();
    }

    /** One range flattened onto the week. {@code day} is kept for the error message. */
    private record Span(DayOfWeek day, int from, int to) {
    }

    public void setRange(LocalTime startTime, LocalTime endTime) {
        requireNotNull(startTime, "startTime");
        requireNotNull(endTime, "endTime");
        if (startTime.equals(endTime)) {
            throw new IllegalArgumentException(
                    "startTime and endTime must differ; endTime before startTime means the range crosses midnight");
        }
        this.startTime = startTime;
        this.endTime = endTime;
    }

    private static <T> T requireNotNull(T value, String field) {
        if (value == null) {
            throw new IllegalArgumentException(field + " must not be null");
        }
        return value;
    }
}
