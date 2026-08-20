package com.slotflow.security;

import java.time.ZoneId;
import java.util.Currency;
import java.util.UUID;

/**
 * The tenant, as much of it as an authenticated session needs to render a shell: the name in the
 * header, the zone every time is displayed in, and the currency every price is formatted with.
 *
 * <p>{@code ZoneId} and {@code Currency} rather than strings, because Jackson already writes them
 * as {@code "Europe/Paris"} and {@code "EUR"} — the exact wire values — and keeping the types means
 * the mapper needs no conversion and a wrong value cannot be constructed.
 */
public record BusinessSummary(
        UUID id,
        String slug,
        String name,
        ZoneId timezone,
        Currency currency) {
}
