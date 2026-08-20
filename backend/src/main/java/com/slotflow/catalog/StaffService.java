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
 *
 * <h2>Why there is a business id on a row that carries no information</h2>
 * Nothing reads {@code businessId} — there is no getter-driven use case for it, and no query
 * filters on it. It is here because the table's two foreign keys are composite,
 * {@code (staff_id, business_id)} and {@code (service_id, business_id)}, and that is what makes
 * "this staff member and this service are in the same tenant" a referential guarantee instead of
 * an assertion some service class has to remember to make. Assigning another tenant's staff
 * member to one of our services is not rejected here; it is unrepresentable.
 *
 * <p>It is deliberately not part of the {@code @IdClass}: the identity of the row is still the
 * pair, and the tenant is a fact about that pair rather than part of what makes it unique.
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

    /** The tenant both sides must belong to; see the class javadoc for why it exists. */
    @Column(nullable = false, updatable = false)
    private UUID businessId;

    public StaffService(UUID businessId, UUID staffId, UUID serviceId) {
        this.businessId = businessId;
        this.staffId = staffId;
        this.serviceId = serviceId;
    }

    /**
     * Identity is the pair, matching the primary key; businessId is derived from either half.
     *
     * <p>Read through the getters, not the fields: a Hibernate proxy is a generated subclass whose
     * inherited fields are never populated, so a field read would compare against two nulls.
     */
    @Override
    public boolean equals(Object other) {
        return other instanceof StaffService assignment
                && staffId.equals(assignment.getStaffId())
                && serviceId.equals(assignment.getServiceId());
    }

    @Override
    public int hashCode() {
        return staffId.hashCode() * 31 + serviceId.hashCode();
    }
}
