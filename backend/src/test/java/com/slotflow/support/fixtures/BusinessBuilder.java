package com.slotflow.support.fixtures;

import com.slotflow.business.Business;
import java.time.ZoneId;
import java.util.Currency;

/**
 * A tenant. Defaults to a Paris clinic charging euros and taking no deposit.
 *
 * <p>Paris rather than UTC on purpose: a business in UTC would pass every test in plan 09 while
 * proving nothing about DST, and a default that hides bugs is worse than no default.
 */
public final class BusinessBuilder {

    private String slug = "clinic-" + Fixtures.uniqueSuffix();
    private String name = "Dana Clinic";
    private ZoneId timezone = ZoneId.of("Europe/Paris");
    private Currency currency = Currency.getInstance("EUR");
    private boolean depositRequired;
    private int depositPercent;

    BusinessBuilder() {}

    public BusinessBuilder withSlug(String slug) {
        this.slug = slug;
        return this;
    }

    public BusinessBuilder withName(String name) {
        this.name = name;
        return this;
    }

    /** String overload because a test reads better as {@code withTimezone("America/New_York")}. */
    public BusinessBuilder withTimezone(String zoneId) {
        return withTimezone(ZoneId.of(zoneId));
    }

    public BusinessBuilder withTimezone(ZoneId timezone) {
        this.timezone = timezone;
        return this;
    }

    public BusinessBuilder withCurrency(String isoCode) {
        this.currency = Currency.getInstance(isoCode);
        return this;
    }

    /** Turns deposits on at that percentage, which is the only way they are ever on. */
    public BusinessBuilder withDeposit(int percent) {
        this.depositRequired = true;
        this.depositPercent = percent;
        return this;
    }

    public Business build() {
        Business business = new Business(slug, name, timezone, currency);
        if (depositRequired) {
            business.setDepositPolicy(true, depositPercent);
        }
        return business;
    }
}
