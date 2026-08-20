package com.slotflow.support.fixtures;

import com.slotflow.availability.AvailabilityOverride;
import com.slotflow.business.Business;
import com.slotflow.staff.User;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;

/**
 * A one-off change to availability. Defaults to a whole-day block for one staff member.
 *
 * <p>{@code businessWide()} drops the staff id, which is what makes it a closure for everybody
 * (D5) — and the case worth having a builder for, because it is the one a test is most likely to
 * get subtly wrong by setting a staff id anyway.
 */
public final class AvailabilityOverrideBuilder {

    private UUID businessId = UUID.randomUUID();
    private UUID staffId = UUID.randomUUID();
    private LocalDate date = LocalDate.of(2026, 3, 2);
    private LocalTime startTime;
    private LocalTime endTime;
    private boolean blocked = true;
    private String reason = "Fixture";

    AvailabilityOverrideBuilder() {
    }

    public AvailabilityOverrideBuilder forBusiness(Business business) {
        return forBusiness(business.getId());
    }

    public AvailabilityOverrideBuilder forBusiness(UUID businessId) {
        this.businessId = businessId;
        return this;
    }

    public AvailabilityOverrideBuilder forStaff(User staff) {
        return forStaff(staff.getId());
    }

    public AvailabilityOverrideBuilder forStaff(UUID staffId) {
        this.staffId = staffId;
        return this;
    }

    /** Applies to every staff member, now and in the future (D5). */
    public AvailabilityOverrideBuilder businessWide() {
        this.staffId = null;
        return this;
    }

    public AvailabilityOverrideBuilder on(LocalDate date) {
        this.date = date;
        return this;
    }

    public AvailabilityOverrideBuilder on(String isoDate) {
        this.date = LocalDate.parse(isoDate);
        return this;
    }

    public AvailabilityOverrideBuilder wholeDay() {
        this.startTime = null;
        this.endTime = null;
        return this;
    }

    public AvailabilityOverrideBuilder between(String startTime, String endTime) {
        this.startTime = LocalTime.parse(startTime);
        this.endTime = LocalTime.parse(endTime);
        return this;
    }

    public AvailabilityOverrideBuilder blocked() {
        this.blocked = true;
        return this;
    }

    /** Extra hours are always a range, so this defaults one if the test did not set it. */
    public AvailabilityOverrideBuilder extra() {
        this.blocked = false;
        if (startTime == null) {
            between("18:00", "20:00");
        }
        return this;
    }

    public AvailabilityOverrideBuilder because(String reason) {
        this.reason = reason;
        return this;
    }

    public AvailabilityOverride build() {
        if (!blocked) {
            return AvailabilityOverride.extraHours(businessId, staffId, date, startTime, endTime, reason);
        }
        if (startTime == null) {
            return staffId == null
                    ? AvailabilityOverride.businessWideClosure(businessId, date, reason)
                    : AvailabilityOverride.blockedDay(businessId, staffId, date, reason);
        }
        return AvailabilityOverride.blockedRange(businessId, staffId, date, startTime, endTime, reason);
    }
}
