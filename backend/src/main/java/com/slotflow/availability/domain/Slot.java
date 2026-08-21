package com.slotflow.availability.domain;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * One bookable start time, and everyone who could take it.
 *
 * <h2>Why the staff ids are here</h2>
 * An "any staff member" query unions several people's calendars and dedupes by start instant, so
 * something has to decide which of them a deduped 10:00 belongs to. Deciding it <em>here</em> —
 * picking the first, say — would be the engine quietly always sending work to the staff member with
 * the lowest id, and it would throw away the only place the alternatives are known. So the slot
 * carries every candidate and plan 10 chooses between them when the booking is actually made
 * (fewest bookings that day, then lowest id), which spreads the load and costs the booking path no
 * extra query.
 *
 * <p>{@code start} and {@code end} are what the customer sees. The buffers around them are already
 * accounted for — a slot is only offered if its buffers fit inside the working window — but they
 * are deliberately not published: the customer books sixty minutes, and the eighty the calendar
 * loses are none of their business.
 *
 * @param start    inclusive, UTC
 * @param end      exclusive, UTC: {@code start} plus the service duration
 * @param staffIds every staff member who could serve this start, sorted, never empty
 */
public record Slot(Instant start, Instant end, List<UUID> staffIds) {

    public Slot {
        if (start == null || end == null) {
            throw new IllegalArgumentException("a slot needs both a start and an end");
        }
        if (!start.isBefore(end)) {
            throw new IllegalArgumentException("a slot must start strictly before it ends");
        }
        if (staffIds == null || staffIds.isEmpty()) {
            throw new IllegalArgumentException("a slot nobody can serve is not a slot");
        }
        // Sorted and copied, so that the response is stable across runs whatever order the
        // candidate staff were loaded in — a customer refreshing the page must not see it shuffle.
        List<UUID> sorted = new ArrayList<>(staffIds);
        sorted.sort(null);
        staffIds = List.copyOf(sorted);
    }

    public static Slot of(Instant start, long durationMinutes, Collection<UUID> staffIds) {
        return new Slot(start, start.plusSeconds(durationMinutes * 60L), List.copyOf(staffIds));
    }

    /** The customer-visible window. The blocked window is wider; see {@code ServiceOffering}. */
    public TimeWindow window() {
        return new TimeWindow(start, end);
    }
}
