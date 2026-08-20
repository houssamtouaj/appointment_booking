package com.slotflow.business;

import com.slotflow.common.jpa.AbstractMutableEntity;
import com.slotflow.tenant.TenantOwned;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.ZoneId;
import java.util.Currency;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * The tenant root. Everything else in the schema hangs off one of these.
 *
 * <p>Two fields carry more weight than their type suggests:
 *
 * <ul>
 *   <li><b>{@code slug}</b> is the public URL segment, so it is immutable once created. A booking
 *       page whose address changes breaks every link a business has ever sent a customer.</li>
 *   <li><b>{@code timezone}</b> frames the business day. Working hours are wall-clock times
 *       interpreted in <em>this</em> zone, never the customer's, because a salon opens at 09:00
 *       local whatever the phone booking it says (D11).</li>
 * </ul>
 */
@Entity
@Table(name = "business")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Business extends AbstractMutableEntity implements TenantOwned {

    /** Mirrors {@code business_slug_format_chk}, so a bad slug fails in Java before it fails in SQL. */
    private static final Pattern SLUG_FORMAT = Pattern.compile("^[a-z0-9-]{3,40}$");

    @Column(nullable = false, length = 40, unique = true, updatable = false)
    private String slug;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(nullable = false, length = 64)
    private ZoneId timezone;

    @Column(nullable = false, length = 3)
    private Currency currency;

    @Column(nullable = false)
    private boolean depositRequired;

    /** 0–100. Meaningless unless {@code depositRequired}; see {@link #requiresDeposit()}. */
    @Column(nullable = false)
    private int depositPercent;

    public Business(String slug, String name, ZoneId timezone, Currency currency) {
        this.slug = normaliseSlug(slug);
        this.name = requireText(name, "name");
        this.timezone = requireNotNull(timezone, "timezone");
        this.currency = requireNotNull(currency, "currency");
        this.depositRequired = false;
        this.depositPercent = 0;
    }

    /** {@code Business} is its own tenant, so the guard in plan 06 needs no special case for it. */
    @Override
    public UUID getBusinessId() {
        return getId();
    }

    // ---------------------------------------------------------------------------------
    //  behaviour
    // ---------------------------------------------------------------------------------

    /**
     * A percentage of zero is treated as "no deposit" even when the flag is set. The database
     * allows that combination and it has no useful meaning: it would create a {@code PENDING}
     * booking, send the customer to Stripe for nothing, and hold the slot for 30 minutes on a
     * payment of zero.
     */
    public boolean requiresDeposit() {
        return depositRequired && depositPercent > 0;
    }

    /**
     * The deposit for a price, in minor units.
     *
     * <p>Integer arithmetic throughout, rounding half up. There is no {@code double} anywhere
     * near a price in this codebase: {@code 0.1 + 0.2} is the classic demonstration, and a
     * deposit that is one cent off a Stripe charge is a reconciliation problem, not a rounding
     * curiosity. The result is capped at the price, so a misconfigured 150 % cannot ask a
     * customer for more than the appointment costs.
     */
    public long depositFor(long priceCents) {
        if (!requiresDeposit() || priceCents <= 0) {
            return 0L;
        }
        long scaled = Math.addExact(Math.multiplyExact(priceCents, depositPercent), 50L);
        return Math.min(scaled / 100L, priceCents);
    }

    public void rename(String name) {
        this.name = requireText(name, "name");
    }

    /**
     * Load-bearing, and deliberately a named method rather than a setter. Every future slot the
     * engine computes moves with this value, so plan 08 requires an explicit confirmation flag
     * on the endpoint that calls it and reports the number of affected bookings first.
     */
    public void moveToTimezone(ZoneId timezone) {
        this.timezone = requireNotNull(timezone, "timezone");
    }

    public void changeCurrency(Currency currency) {
        this.currency = requireNotNull(currency, "currency");
    }

    public void setDepositPolicy(boolean required, int percent) {
        if (percent < 0 || percent > 100) {
            throw new IllegalArgumentException("depositPercent must be between 0 and 100");
        }
        this.depositRequired = required;
        this.depositPercent = percent;
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    /**
     * Lower-cased before the format check, so "Dana-Clinic" becomes a valid slug rather than a
     * validation error. Anything still illegal after that is a genuine mistake and is refused.
     */
    private static String normaliseSlug(String slug) {
        String normalised = requireText(slug, "slug").trim().toLowerCase(Locale.ROOT);
        if (!SLUG_FORMAT.matcher(normalised).matches()) {
            throw new IllegalArgumentException(
                    "slug must be 3-40 characters of lowercase letters, digits or hyphens");
        }
        return normalised;
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value.trim();
    }

    private static <T> T requireNotNull(T value, String field) {
        if (value == null) {
            throw new IllegalArgumentException(field + " must not be null");
        }
        return value;
    }
}
