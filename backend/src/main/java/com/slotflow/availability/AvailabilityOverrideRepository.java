package com.slotflow.availability;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

/**
 * Holidays, one-off blocks and extra hours.
 *
 * <p>Two reads per availability query, not one: the staff-level overrides and the business-wide
 * closures (D5) are different rows with different scoping, and the engine applies the business-wide
 * ones first.
 */
public interface AvailabilityOverrideRepository extends JpaRepository<AvailabilityOverride, UUID> {

    /** Staff-level overrides for the whole range, in one query. */
    List<AvailabilityOverride> findByStaffIdInAndDateBetween(
            Collection<UUID> staffIds, LocalDate from, LocalDate to);

    /**
     * The business-wide closures (D5): {@code staff_id IS NULL}, so they cannot be expressed as a
     * derived query without inventing an {@code IsNull} suffix that reads like a typo. V1 has a
     * partial index for exactly this predicate.
     */
    @Query("""
            select o from AvailabilityOverride o
            where o.businessId = :businessId
              and o.staffId is null
              and o.date between :from and :to
            """)
    List<AvailabilityOverride> findBusinessWideByDateBetween(
            UUID businessId, LocalDate from, LocalDate to);

    /** The merged admin view: business-wide plus every staff member's (plan 08). */
    List<AvailabilityOverride> findByBusinessIdAndDateBetween(
            UUID businessId, LocalDate from, LocalDate to);

    Optional<AvailabilityOverride> findByIdAndBusinessId(UUID id, UUID businessId);
}
