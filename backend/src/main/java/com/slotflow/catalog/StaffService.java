package com.slotflow.catalog;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * Which staff member can perform which service.
 *
 * <h2>Why an explicit entity, and why {@code @IdClass}</h2>
 * Plan 03 offered a choice: an {@code @ElementCollection} of service ids on the staff side, or an
 * explicit join entity. This is the explicit entity, because the join is read from <em>both</em>
 * directions and only one of those is cheap with an element collection:
 *
 * <ul>
 *   <li>"which services does this staff member perform?" — the staff detail screen;</li>
 *   <li>"who can perform this service?" — the public booking flow, step 2 (D9), which would
 *       otherwise have to load every user in the business and inspect their collection.</li>
 * </ul>
 *
 * <p>{@code @IdClass} rather than {@code @EmbeddedId} for one blunt reason: derived queries read
 * as {@code findByServiceId} instead of {@code findByIdServiceId}.
 *
 * <p>Not a {@code @ManyToMany}. Cascading a many-to-many is how deleting a service ends up
 * deleting a staff member, and the collection semantics ("replace the whole set") are clearer as
 * explicit rows anyway. The row carries no information of its own, so both sides cascade in the
 * schema.
 */
@Entity
@Table(name = "staff_service")
@IdClass(StaffServiceId.class)
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class StaffService {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID staffId;

    @Id
    @Column(nullable = false, updatable = false)
    private UUID serviceId;

    public StaffService(UUID staffId, UUID serviceId) {
        this.staffId = staffId;
        this.serviceId = serviceId;
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof StaffService assignment
                && staffId.equals(assignment.staffId)
                && serviceId.equals(assignment.serviceId);
    }

    @Override
    public int hashCode() {
        return staffId.hashCode() * 31 + serviceId.hashCode();
    }
}
