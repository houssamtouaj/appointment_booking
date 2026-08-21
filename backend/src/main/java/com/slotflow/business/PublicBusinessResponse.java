package com.slotflow.business;

import com.slotflow.availability.OpeningHours;
import com.slotflow.catalog.PublicServiceResponse;
import java.util.List;

/**
 * The booking page's first request: everything a landing page needs, in one round trip.
 *
 * <p>Written by hand rather than reusing the admin {@code BusinessResponse}, the same decision as
 * {@code PublicStaffResponse}: the admin record is where a field lands when somebody adds a setting,
 * and a public DTO that inherits those additions publishes them the moment they exist.
 *
 * <p>What is <em>not</em> here is the business id. Every public path is keyed by the slug and every
 * booking is keyed by a service id and a staff id, so the tenant's own uuid is a value no customer
 * flow needs — and the smallest public surface that works is the one to publish.
 *
 * @param timezone        an IANA zone id. Sent as a string rather than left to a Jackson module's
 *                        default, because it is a published contract and not a serialisation detail
 * @param currency        ISO 4217, the unit every {@code priceCents} in {@code services} is counted
 *                        in — carried once here instead of repeated on each service
 * @param depositRequired the effective answer, not the raw column: a business with the flag set and
 *                        a percentage of zero requires no deposit, and saying otherwise would send a
 *                        customer to a checkout for nothing
 * @param openingHours    derived from the union of active staff working hours (D5), one entry per
 *                        day the business is open. See {@link OpeningHours} for what a hull does and
 *                        does not promise
 * @param services        the active catalog, in the same shape the standalone services endpoint
 *                        returns
 */
public record PublicBusinessResponse(
        String slug,
        String name,
        String timezone,
        String currency,
        boolean depositRequired,
        int depositPercent,
        List<OpeningHours> openingHours,
        List<PublicServiceResponse> services) {
}
