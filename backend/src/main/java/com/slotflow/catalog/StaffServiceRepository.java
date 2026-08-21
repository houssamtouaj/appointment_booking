package com.slotflow.catalog;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

/**
 * The staff-to-service assignment, read from both directions.
 *
 * <p>Plan 03's table lists only {@code ServiceOfferingRepository} for this package; this one is the
 * deliberate addition, because the join is queried on its own in two places — the public
 * "who performs this service" list (D9) and the assignment replace in plan 07 — and neither can go
 * through the service repository.
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

    boolean existsByStaffIdAndServiceId(UUID staffId, UUID serviceId);

    /**
     * Plan 07 replaces the whole assignment set on write, in one transaction.
     *
     * <p>Bulk {@code delete} queries rather than derived {@code deleteBy…} methods, which Spring
     * Data makes neither transactional nor modifying: the first caller outside a transaction gets
     * {@code TransactionRequiredException}, and inside one they load every matching row before
     * removing them one at a time. {@code clearAutomatically} because the replacement rows are
     * saved straight afterwards and the context must not still hold the deleted ones.
     */
    @Modifying(clearAutomatically = true)
    @Transactional
    @Query("delete from StaffService s where s.serviceId = :serviceId")
    int deleteByServiceId(UUID serviceId);

    @Modifying(clearAutomatically = true)
    @Transactional
    @Query("delete from StaffService s where s.staffId = :staffId")
    int deleteByStaffId(UUID staffId);
}
