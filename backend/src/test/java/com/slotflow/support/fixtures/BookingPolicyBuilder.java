package com.slotflow.support.fixtures;

import com.slotflow.business.Business;
import com.slotflow.business.BookingPolicy;
import java.util.UUID;

/**
 * A booking policy. Defaults to the schema's own defaults, so a test that does not care about
 * policy gets the behaviour a freshly registered business would have.
 */
public final class BookingPolicyBuilder {

    private UUID businessId = UUID.randomUUID();
    private int minLeadTimeHours = 2;
    private int maxAdvanceDays = 60;
    private int cancellationCutoffHours = 24;
    private int slotGranularityMinutes = 15;

    BookingPolicyBuilder() {
    }

    public BookingPolicyBuilder forBusiness(Business business) {
        return forBusiness(business.getId());
    }

    public BookingPolicyBuilder forBusiness(UUID businessId) {
        this.businessId = businessId;
        return this;
    }

    public BookingPolicyBuilder withLeadTimeHours(int hours) {
        this.minLeadTimeHours = hours;
        return this;
    }

    public BookingPolicyBuilder withMaxAdvanceDays(int days) {
        this.maxAdvanceDays = days;
        return this;
    }

    public BookingPolicyBuilder withCancellationCutoffHours(int hours) {
        this.cancellationCutoffHours = hours;
        return this;
    }

    public BookingPolicyBuilder withGranularityMinutes(int minutes) {
        this.slotGranularityMinutes = minutes;
        return this;
    }

    /** No lead time and no cutoff: the policy that gets out of the way of a test about something else. */
    public BookingPolicyBuilder permissive() {
        this.minLeadTimeHours = 0;
        this.cancellationCutoffHours = 0;
        this.maxAdvanceDays = 365;
        return this;
    }

    public BookingPolicy build() {
        return new BookingPolicy(businessId, minLeadTimeHours, maxAdvanceDays,
                cancellationCutoffHours, slotGranularityMinutes);
    }
}
