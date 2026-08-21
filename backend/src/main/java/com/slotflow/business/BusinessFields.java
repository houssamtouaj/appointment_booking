package com.slotflow.business;

import com.slotflow.common.error.ApiException;
import java.time.ZoneId;
import java.util.Currency;
import java.util.Locale;

/**
 * The two business fields bean validation cannot check, parsed in one place.
 *
 * <p>Both are "well-formed but unknown": {@code @Pattern} can prove that {@code Europe/Atlantis} is
 * three-letters-slash-a-word and that {@code XYZ} is three upper-case letters, and neither is a real
 * zone or a real currency. So the check has to be code, and the code has to be shared —
 * {@code POST /api/auth/register} creates a business with both fields and {@code PUT /api/business}
 * edits them, and if registration rejected an offset zone that the settings screen accepted, the
 * rule would be whichever endpoint the client happened to use.
 *
 * <p>A utility class rather than a bean: these are pure functions of a string with no dependency to
 * inject, and the two callers are in different packages.
 */
public final class BusinessFields {

    private BusinessFields() {
    }

    /**
     * An IANA <em>region</em> id, and nothing else.
     *
     * <p>{@code ZoneId.of("+02:00")} parses happily and then carries no DST rules at all, which is
     * the one thing a business day genuinely needs: a salon that opens at 09:00 keeps opening at
     * 09:00 through the March transition, and on a fixed offset it would open at 08:00 all summer
     * (D11). {@code getAvailableZoneIds} is the region set, so the check is the whole rule.
     */
    public static ZoneId timezone(String timezone) {
        String candidate = timezone == null ? "" : timezone.trim();
        if (!ZoneId.getAvailableZoneIds().contains(candidate)) {
            throw ApiException.invalidField("timezone",
                    "must be an IANA zone id such as Europe/Paris");
        }
        return ZoneId.of(candidate);
    }

    /** ISO 4217, upper-cased on the way in so "eur" is a usable answer rather than a 422. */
    public static Currency currency(String currency) {
        try {
            return Currency.getInstance(currency.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException | NullPointerException e) {
            throw ApiException.invalidField("currency",
                    "must be a valid ISO 4217 currency code");
        }
    }
}
