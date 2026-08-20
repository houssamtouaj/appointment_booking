package com.slotflow.support.fixtures;

import com.slotflow.availability.WorkingHours;
import com.slotflow.staff.User;
import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * A row of the weekly template. Defaults to Monday, 09:00–17:00 — which pairs with
 * {@code TestTime.NOW} being a Monday morning, so "today" and "the configured day" line up.
 */
public final class WorkingHoursBuilder {

    private UUID staffId = UUID.randomUUID();
    private DayOfWeek dayOfWeek = DayOfWeek.MONDAY;
    private LocalTime startTime = LocalTime.of(9, 0);
    private LocalTime endTime = LocalTime.of(17, 0);

    WorkingHoursBuilder() {
    }

    public WorkingHoursBuilder forStaff(User staff) {
        return forStaff(staff.getId());
    }

    public WorkingHoursBuilder forStaff(UUID staffId) {
        this.staffId = staffId;
        return this;
    }

    public WorkingHoursBuilder on(DayOfWeek dayOfWeek) {
        this.dayOfWeek = dayOfWeek;
        return this;
    }

    /** {@code from("09:00").to("17:00")} — shorter than two {@code LocalTime.of} calls, and reads. */
    public WorkingHoursBuilder from(String localTime) {
        this.startTime = LocalTime.parse(localTime);
        return this;
    }

    public WorkingHoursBuilder to(String localTime) {
        this.endTime = LocalTime.parse(localTime);
        return this;
    }

    public WorkingHoursBuilder from(LocalTime startTime) {
        this.startTime = startTime;
        return this;
    }

    public WorkingHoursBuilder to(LocalTime endTime) {
        this.endTime = endTime;
        return this;
    }

    /** 22:00–02:00: an end before the start, which is a night shift and not a mistake. */
    public WorkingHoursBuilder overnight() {
        this.startTime = LocalTime.of(22, 0);
        this.endTime = LocalTime.of(2, 0);
        return this;
    }

    public WorkingHours build() {
        return new WorkingHours(staffId, dayOfWeek, startTime, endTime);
    }

    /**
     * The same range on every listed day, which is what a real weekly template looks like and what
     * plan 08's {@code PUT} replaces in one transaction.
     */
    public List<WorkingHours> buildFor(DayOfWeek... days) {
        List<WorkingHours> week = new ArrayList<>();
        for (DayOfWeek day : days) {
            week.add(new WorkingHours(staffId, day, startTime, endTime));
        }
        return week;
    }

    /** Monday to Friday, the default range. */
    public List<WorkingHours> buildWeekdays() {
        return buildFor(DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY,
                DayOfWeek.THURSDAY, DayOfWeek.FRIDAY);
    }
}
