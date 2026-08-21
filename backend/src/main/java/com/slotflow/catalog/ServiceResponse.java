package com.slotflow.catalog;

import java.util.List;
import java.util.UUID;

/**
 * A service, as the admin screens see it.
 *
 * <p>Two of these members are derived rather than stored, and both exist to answer a question the
 * owner would otherwise have to work out from the other fields:
 *
 * <ul>
 *   <li><b>{@code totalBlockMinutes}</b> — what one appointment actually costs the calendar, buffers
 *       included. Read off {@link ServiceOffering#totalBlockMinutes()} rather than added up in the
 *       client, so the number on the screen is the number the availability engine and the database's
 *       exclusion constraint use (D4).</li>
 *   <li><b>{@code bookable}</b> — whether this service can produce a single slot. A service with
 *       nobody assigned is legal and silently invisible on the booking page, and "why does nothing
 *       show up?" is the support thread this flag exists to prevent. It is false when the service is
 *       inactive, when nobody is assigned, and when everybody assigned has been deactivated — all
 *       three produce exactly no availability, and the admin UI's warning is as useful for the third
 *       as for the second.</li>
 * </ul>
 *
 * <p>Its public counterpart, {@link PublicServiceResponse}, is a separate record: buffers are
 * internal scheduling, and {@code active} and {@code bookable} are questions a customer never asks.
 *
 * @param staffIds who performs it, in no particular order beyond being stable within a response
 */
public record ServiceResponse(
        UUID id,
        String name,
        String description,
        int durationMinutes,
        long priceCents,
        int bufferBeforeMinutes,
        int bufferAfterMinutes,
        int totalBlockMinutes,
        boolean active,
        boolean bookable,
        List<UUID> staffIds) {
}
