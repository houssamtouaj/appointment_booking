package com.slotflow.availability;

import com.slotflow.common.jpa.AbstractMutableEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.DayOfWeek;
import java.time.LocalTime;
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
     * How long the shift lasts, in minutes, counting a midnight crossing correctly. Useful for the
     * derived opening hours on the public business page (plan 07) and for asserting that a service
     * cannot possibly fit.
     */
    public int durationMinutes() {
        int start = startTime.toSecondOfDay() / 60;
        int end = endTime.toSecondOfDay() / 60;
        return crossesMidnight() ? (24 * 60 - start) + end : end - start;
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
