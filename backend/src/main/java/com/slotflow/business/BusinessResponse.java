package com.slotflow.business;

import java.util.UUID;

/**
 * A business, as its own settings screen reads it.
 *
 * <p>The deposit fields are the <em>stored</em> ones, not the effective answer: a form has to show
 * what it saved, so a checkbox left on with a percentage of zero comes back exactly that way. The
 * public page reports {@code depositRequired: false} for the same row, because a customer cares
 * whether they will be asked for money and not what the two columns say. The two views disagreeing
 * on purpose is why they are two records.
 *
 * @param slug read-only: the public URL segment, immutable once created. It is here because the
 *             settings screen shows the booking page's address, and absent from
 *             {@link BusinessRequest} because nothing can change it
 */
public record BusinessResponse(
        UUID id,
        String slug,
        String name,
        String timezone,
        String currency,
        boolean depositRequired,
        int depositPercent) {

    static BusinessResponse of(Business business) {
        return new BusinessResponse(
                business.getId(),
                business.getSlug(),
                business.getName(),
                // Explicit strings rather than letting Jackson serialise a ZoneId and a Currency
                // however its modules happen to: these two members are a published contract, and
                // "Europe/Paris" and "EUR" are what the client sends back.
                business.getTimezone().getId(),
                business.getCurrency().getCurrencyCode(),
                business.isDepositRequired(),
                business.getDepositPercent());
    }
}
