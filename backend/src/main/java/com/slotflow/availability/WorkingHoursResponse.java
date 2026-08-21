package com.slotflow.availability;

import java.util.List;
import java.util.UUID;

/**
 * A staff member's weekly template, in the shape the {@code PUT} accepts back.
 *
 * <p>Symmetry is the feature: the editor loads this, edits the list, and sends it to the same path
 * unchanged. Anything the response carried that the request did not — row ids, timestamps — would be
 * something the client has to strip before saving.
 *
 * <p>Ordered Monday first and then by start time, so the grid draws itself and a split shift reads in
 * the order it is worked.
 *
 * @param staffId echoed back because the response is cached and rendered per person, and a template
 *                with no owner on it is one mix-up away from being shown against the wrong name
 */
public record WorkingHoursResponse(UUID staffId, List<WorkingHoursRange> ranges) {
}
