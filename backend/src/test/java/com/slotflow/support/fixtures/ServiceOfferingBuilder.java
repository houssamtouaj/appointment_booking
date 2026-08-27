package com.slotflow.support.fixtures;

import com.slotflow.business.Business;
import com.slotflow.catalog.ServiceOffering;
import java.util.UUID;

/**
 * A bookable service. Defaults to a 60-minute, €50 consultation with no buffers.
 *
 * <p>No buffers by default so that a test which mentions {@code withBuffers(10, 10)} is visibly a
 * test about buffers, and one that does not is visibly not.
 */
public final class ServiceOfferingBuilder {

    private UUID businessId = UUID.randomUUID();
    private String name = "Consultation";
    private String description;
    private int durationMinutes = 60;
    private long priceCents = 5_000L;
    private int bufferBeforeMinutes;
    private int bufferAfterMinutes;
    private boolean active = true;

    ServiceOfferingBuilder() {}

    public ServiceOfferingBuilder forBusiness(Business business) {
        return forBusiness(business.getId());
    }

    public ServiceOfferingBuilder forBusiness(UUID businessId) {
        this.businessId = businessId;
        return this;
    }

    public ServiceOfferingBuilder withName(String name) {
        this.name = name;
        return this;
    }

    public ServiceOfferingBuilder withDescription(String description) {
        this.description = description;
        return this;
    }

    public ServiceOfferingBuilder withDuration(int durationMinutes) {
        this.durationMinutes = durationMinutes;
        return this;
    }

    public ServiceOfferingBuilder withPriceCents(long priceCents) {
        this.priceCents = priceCents;
        return this;
    }

    /** Setup and cleanup time, in that order. Both at once, because they are one decision. */
    public ServiceOfferingBuilder withBuffers(int beforeMinutes, int afterMinutes) {
        this.bufferBeforeMinutes = beforeMinutes;
        this.bufferAfterMinutes = afterMinutes;
        return this;
    }

    /** Soft-deleted: still in the database, gone from the public list. */
    public ServiceOfferingBuilder inactive() {
        this.active = false;
        return this;
    }

    public ServiceOffering build() {
        ServiceOffering service = new ServiceOffering(businessId, name, durationMinutes, priceCents);
        service.describe(description);
        service.setBuffers(bufferBeforeMinutes, bufferAfterMinutes);
        if (!active) {
            service.deactivate();
        }
        return service;
    }
}
