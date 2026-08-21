package com.slotflow.catalog;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * The staff-to-service assignment, read from both directions.
 *
 * <p>Plan 03's table lists only {@code ServiceOfferingRepository} for this package; this one is the
 * deliberate addition, because the join is queried on its own in two places — the public
 * "who performs this service" list (D9) and the assignment replace in plan 07 — and neither can go
 * through the service repository.
 *
 * <p><b>There is no bulk delete here, and there were two.</b> Plan 03 added
 * {@code deleteByServiceId} / {@code deleteByStaffId} in anticipation of plan 07 replacing the whole
 * assignment set with a delete and a reinsert. It does not: {@code CatalogAdminService} writes the
 * difference instead, so an owner who saves a form without touching the assignments performs no
 * writes at all, and the rows — which carry nothing beyond the pair — are not rewritten to the same
 * values. Nothing else in v1 ever removes an assignment either, because a service is soft-deleted
 * and a staff member is deactivated rather than dropped. Two methods documented as having a caller
 * and never acquiring one are worse than absent, so they are gone; a future caller can restore them
 * along with its own reasons.
 */
public interface StaffServiceRepository extends JpaRepository<StaffService, StaffServiceId> {

    /** "Who can perform this service?" — booking flow step 2 (D9), and the engine's staff set. */
    List<StaffService> findByServiceId(UUID serviceId);

    /** "What does this staff member do?" — the staff detail screen. */
    List<StaffService> findByStaffId(UUID staffId);

    /**
     * The same question for a whole team in one query. Plan 06's staff list needs the assignments
     * of every row on the page, and asking per row is an N+1 that grows with the tenant.
     */
    default List<StaffService> findForStaff(Collection<UUID> staffIds) {
        return staffIds.isEmpty() ? List.of() : findByStaffIdIn(staffIds);
    }

    List<StaffService> findByStaffIdIn(Collection<UUID> staffIds);

    /**
     * The mirror of {@link #findForStaff}, for the other list that reads this table a page at a
     * time: plan 07's catalog grid shows who performs each service, and asking per row is the same
     * N+1 from the other direction.
     */
    default List<StaffService> findForServices(Collection<UUID> serviceIds) {
        return serviceIds.isEmpty() ? List.of() : findByServiceIdIn(serviceIds);
    }

    List<StaffService> findByServiceIdIn(Collection<UUID> serviceIds);

    boolean existsByStaffIdAndServiceId(UUID staffId, UUID serviceId);
}
