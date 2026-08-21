package com.slotflow.catalog;

import java.util.UUID;

/**
 * A service, as a customer sees it on the booking page.
 *
 * <p>Written by hand rather than derived from {@link ServiceResponse}, for the reason
 * {@code PublicStaffResponse} spells out: reusing an admin record on a public endpoint publishes
 * every field it ever grows, and the leak arrives through a change to a class nobody was thinking
 * about at the time.
 *
 * <p>What is deliberately absent is the buffers. A 60-minute massage with ten minutes either side
 * costs the calendar eighty, and the customer is booking sixty — telling them otherwise invites the
 * question of what the other twenty minutes are for. {@code active} and {@code bookable} are absent
 * for a simpler reason: this list only ever contains services that are both.
 *
 * @param priceCents minor units of the business currency, which the business page carries once
 *                   rather than repeating on every service
 */
public record PublicServiceResponse(
        UUID id,
        String name,
        String description,
        int durationMinutes,
        long priceCents) {
}
