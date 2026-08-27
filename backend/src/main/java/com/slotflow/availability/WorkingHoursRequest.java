package com.slotflow.availability;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * {@code PUT /api/staff/{id}/working-hours}: the whole week, every time.
 *
 * <h2>Why a full replace and not a patch</h2>
 * The editor is a seven-row grid, and the server's copy has to end up being exactly what is on the
 * screen. A per-row {@code PATCH} makes the client responsible for working out which rows were
 * added, edited and removed since it loaded the page, and for issuing them in an order that never
 * leaves a half-saved week behind — a synchronisation problem, on the client, for no benefit. One
 * body, one transaction, one outcome.
 *
 * <h2>A flat list, not a map of seven days</h2>
 * Multiple ranges per weekday are the normal case, not an edge one: 09:00–12:00 and 13:00–17:00 is
 * most of hospitality, and {@code working_hours} allows many rows per {@code (staff_id, day)} for
 * exactly that reason. A flat list maps one-to-one onto those rows, and <b>a day with no entry means
 * "not working"</b> rather than "inherit" — there is nothing to inherit from, and a full replace
 * could not express "leave Thursday as it was" even if there were.
 *
 * <p>{@code ranges: []} is therefore a legal and meaningful body: this person works no fixed hours.
 * It is required rather than optional, so that clearing the week is something a client says instead
 * of something it forgets to send.
 *
 * @param ranges the whole template. Ranges must not overlap once laid out on the week, or the answer
 *               is {@code 422 HOURS_OVERLAP}; see {@link WorkingHours#findOverlap}
 */
public record WorkingHoursRequest(

        @NotNull
        // Ten shifts a day is already absurd, and the cap is what stops one request inserting an
        // unbounded number of rows. Everything else in this API that accepts a collection is
        // bounded too, whether by a page size or by a check like this one.
        @Size(max = 70) List<@Valid @NotNull WorkingHoursRange> ranges) {
}
