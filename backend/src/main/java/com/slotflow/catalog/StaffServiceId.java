package com.slotflow.catalog;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

/**
 * The composite key of {@link StaffService}.
 *
 * <p>A plain class rather than a record because JPA requires an {@code @IdClass} to have a public
 * no-argument constructor, which a record cannot offer.
 */
public class StaffServiceId implements Serializable {

    private UUID staffId;
    private UUID serviceId;

    /** Required by JPA. */
    public StaffServiceId() {
    }

    public StaffServiceId(UUID staffId, UUID serviceId) {
        this.staffId = staffId;
        this.serviceId = serviceId;
    }

    public UUID getStaffId() {
        return staffId;
    }

    public UUID getServiceId() {
        return serviceId;
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof StaffServiceId id
                && Objects.equals(staffId, id.staffId)
                && Objects.equals(serviceId, id.serviceId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(staffId, serviceId);
    }

    @Override
    public String toString() {
        return "StaffServiceId(staffId=" + staffId + ", serviceId=" + serviceId + ")";
    }
}
