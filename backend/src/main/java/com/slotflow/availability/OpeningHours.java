package com.slotflow.availability;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * When a business is open on one weekday, derived from its staff's working hours (D5).
 *
 * <p>The landing page needs a line per day, and nothing in the schema stores one: hours belong to
 * people, not to businesses. So this is the union — earliest start to latest end across every
 * <em>active</em> staff member's ranges for that day — and it is a hull rather than a schedule. A
 * salon whose only two staff work 09:00–12:00 and 14:00–18:00 reports 09:00–18:00, which is what a
 * customer reads as "open today"; whether any particular minute inside it is bookable is the
 * availability engine's answer (plan 09), and that endpoint is the one the calendar calls.
 *
 * <h2>Why {@code closesNextDay} exists</h2>
 * A 22:00–02:00 night shift is legal ({@link WorkingHours}), and its end is on the following date.
 * Reporting {@code opensAt: 22:00, closesAt: 02:00} without saying so leaves a client to guess
 * whether the bar shuts four hours later or twenty hours earlier. One boolean settles it, and the
 * comparison behind the scenes is done in minutes-from-midnight so a shift ending at 02:00 counts as
 * later than one ending at 23:00 rather than earlier.
 *
 * @param dayOfWeek     the {@code java.time} name, as everywhere else in this API (D16)
 * @param opensAt       the earliest start any active staff member works that day
 * @param closesAt      the latest end. Wall-clock, so it may read as earlier than {@code opensAt}
 * @param closesNextDay true when the latest end falls on the following date
 */
public record OpeningHours(DayOfWeek dayOfWeek, LocalTime opensAt, LocalTime closesAt,
        boolean closesNextDay) {

    private static final int MINUTES_PER_DAY = 24 * 60;

    /**
     * The weekly hull of a set of working-hours rows, Monday first.
     *
     * <p>Days nobody works are absent rather than present with nulls. "Closed on Sunday" and "no
     * hours configured yet" are the same fact for a landing page, and a list of the days a business
     * is open renders directly; a client that wants a seven-row grid is the admin editor, and it
     * reads the template itself rather than this.
     *
     * <p>A pure function of its argument, with no repository and no clock, so every case worth
     * arguing about — the split shift, the night shift, the two staff whose hours barely overlap —
     * is a unit test that runs in microseconds.
     */
    public static List<OpeningHours> derive(Collection<WorkingHours> ranges) {
        Map<DayOfWeek, int[]> hull = new EnumMap<>(DayOfWeek.class);
        for (WorkingHours range : ranges) {
            int opens = range.startMinuteOfDay();
            int closes = opens + range.durationMinutes();
            hull.merge(range.getDayOfWeek(), new int[] { opens, closes },
                    (existing, candidate) -> new int[] {
                            Math.min(existing[0], candidate[0]),
                            Math.max(existing[1], candidate[1]) });
        }

        List<OpeningHours> week = new ArrayList<>(hull.size());
        // EnumMap iterates in declaration order, which for DayOfWeek is Monday to Sunday — the
        // order the weekly grid is drawn in, and one less thing for a client to sort.
        hull.forEach((day, window) -> week.add(new OpeningHours(day,
                atMinute(window[0]), atMinute(window[1] % MINUTES_PER_DAY),
                window[1] >= MINUTES_PER_DAY)));
        return List.copyOf(week);
    }

    private static LocalTime atMinute(int minuteOfDay) {
        return LocalTime.ofSecondOfDay(minuteOfDay * 60L);
    }
}
