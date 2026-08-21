package com.slotflow.business;

import java.time.Instant;

/**
 * The booking policy, as the settings screen reads it.
 *
 * <p>No business id: there is exactly one policy per tenant and the tenant comes from the token, so
 * an id on the wire would be a value the client could only echo back.
 *
 * @param updatedAt when the policy last changed. Useful in a way the other four are not: availability
 *                  answers change the moment this row does, and "why did the calendar look different
 *                  this morning" is a question this timestamp answers
 */
public record PolicyResponse(
        int minLeadTimeHours,
        int maxAdvanceDays,
        int cancellationCutoffHours,
        int slotGranularityMinutes,
        Instant updatedAt) {
}
