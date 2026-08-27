package com.slotflow.availability;

import com.slotflow.common.jpa.AbstractMutableEntity;
import com.slotflow.tenant.TenantOwned;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * A one-off change to availability on a specific date: a holiday, an afternoon off, a Saturday
 * opening.
 *
 * <h2>A null {@code staffId} is a business-wide closure (D5)</h2>
 * "Closed Christmas Day" is one row that applies to everyone, rather than one row per staff member
 * that silently stops covering people as they join. It also gives the public landing page
 * something true to show. The partial index in V1 exists precisely for this read, which happens
 * on every availability query.
 *
 * <h2>Why the tenant is on the row as well as the staff member</h2>
 * {@code (staff_id, business_id)} is a composite foreign key into {@code app_user}, exactly as on
 * {@code staff_service} and {@code booking}. Nothing here has to check that the staff member is
 * in this tenant, because a row that says otherwise cannot be written — by this class, by psql or
 * by anything else. It matters more here than it looks: the engine reads staff-level overrides by
 * staff id alone, so a cross-tenant row would black out a stranger's calendar in their own
 * business. A null {@code staff_id} skips the check, which is what makes the D5 closure above
 * still expressible.
 *
 * <h2>Both times null means the whole day</h2>
 * One of the two being null is a bug rather than a meaning, and the schema's
 * {@code (start_time IS NULL) = (end_time IS NULL)} check makes that unrepresentable. The
 * factories below are the only way to build one, so the invariant cannot be missed at a call site.
 */
@Entity
@Table(name = "availability_override")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AvailabilityOverride extends AbstractMutableEntity implements TenantOwned {

    @Column(nullable = false, updatable = false)
    private UUID businessId;

    /** Null means every staff member in the business (D5). */
    @Column(updatable = false)
    private UUID staffId;

    @Column(nullable = false)
    private LocalDate date;

    /** Null together with {@link #endTime} for a whole-day override. */
    private LocalTime startTime;

    private LocalTime endTime;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 8)
    private OverrideType type;

    @Column(length = 200)
    private String reason;

    private AvailabilityOverride(UUID businessId, UUID staffId, LocalDate date,
            LocalTime startTime, LocalTime endTime,
            OverrideType type, String reason) {
        this.businessId = requireNotNull(businessId, "businessId");
        this.staffId = staffId;
        this.date = requireNotNull(date, "date");
        this.type = requireNotNull(type, "type");
        this.reason = reason;
        setTimes(startTime, endTime);
    }

    /** A day off for one staff member. */
    public static AvailabilityOverride blockedDay(UUID businessId, UUID staffId,
            LocalDate date, String reason) {
        return new AvailabilityOverride(businessId, staffId, date, null, null,
                OverrideType.BLOCKED, reason);
    }

    /** Part of a day blocked out for one staff member: an appointment elsewhere, a long lunch. */
    public static AvailabilityOverride blockedRange(UUID businessId, UUID staffId, LocalDate date,
            LocalTime startTime, LocalTime endTime,
            String reason) {
        return new AvailabilityOverride(businessId, staffId, date,
                requireNotNull(startTime, "startTime"), requireNotNull(endTime, "endTime"),
                OverrideType.BLOCKED, reason);
    }

    /** Extra hours outside the weekly template. Always a range; never a whole day. */
    public static AvailabilityOverride extraHours(UUID businessId, UUID staffId, LocalDate date,
            LocalTime startTime, LocalTime endTime,
            String reason) {
        return new AvailabilityOverride(businessId, staffId, date,
                requireNotNull(startTime, "startTime"), requireNotNull(endTime, "endTime"),
                OverrideType.EXTRA, reason);
    }

    /** The whole business is shut, whoever is on the payroll that day (D5). OWNER-only in plan 08. */
    public static AvailabilityOverride businessWideClosure(UUID businessId, LocalDate date,
            String reason) {
        return new AvailabilityOverride(businessId, null, date, null, null,
                OverrideType.BLOCKED, reason);
    }

    /**
     * Part of a day shut for everybody: a staff meeting, an early close on Christmas Eve.
     *
     * <p>The same row as the whole-day closure above with times on it, which the schema allows and
     * the engine reads the same way. Only the {@code BLOCKED} direction is expressible business-wide,
     * and that is a decision rather than an omission: extra availability is a statement only the
     * person working it can make, so a business-wide {@code EXTRA} would be the API deciding on
     * somebody's behalf that they are free — see {@code OverrideService}.
     */
    public static AvailabilityOverride businessWideClosure(UUID businessId, LocalDate date,
            LocalTime startTime, LocalTime endTime,
            String reason) {
        return new AvailabilityOverride(businessId, null, date,
                requireNotNull(startTime, "startTime"), requireNotNull(endTime, "endTime"),
                OverrideType.BLOCKED, reason);
    }

    public boolean isWholeDay() {
        return startTime == null;
    }

    public boolean isBusinessWide() {
        return staffId == null;
    }

    public boolean isBlocked() {
        return type == OverrideType.BLOCKED;
    }

    public boolean isExtra() {
        return type == OverrideType.EXTRA;
    }

    /** True for the one case a staff member's own {@code EXTRA} can never override (plan 09). */
    public boolean isWholeDayClosure() {
        return isBlocked() && isWholeDay();
    }

    public void setTimes(LocalTime startTime, LocalTime endTime) {
        if ((startTime == null) != (endTime == null)) {
            throw new IllegalArgumentException(
                    "startTime and endTime must both be set or both be null");
        }
        if (startTime != null && startTime.equals(endTime)) {
            throw new IllegalArgumentException("startTime and endTime must differ");
        }
        if (startTime == null && type == OverrideType.EXTRA) {
            throw new IllegalArgumentException("a whole-day EXTRA override has no meaning");
        }
        this.startTime = startTime;
        this.endTime = endTime;
    }

    public void setReason(String reason) {
        this.reason = reason;
    }

    private static <T> T requireNotNull(T value, String field) {
        if (value == null) {
            throw new IllegalArgumentException(field + " must not be null");
        }
        return value;
    }
}
