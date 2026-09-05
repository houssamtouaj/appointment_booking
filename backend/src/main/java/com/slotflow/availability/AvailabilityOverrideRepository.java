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
 * <p>One read per availability query, not two: the staff-level overrides and the business-wide
 * closures (D5) are different rows with different scoping, but they are rows in the same table, so
 * {@link #findForEngine} fetches both and the engine applies the business-wide ones first.
 */
public interface AvailabilityOverrideRepository extends JpaRepository<AvailabilityOverride, UUID> {

    /**
     * The business-wide closures (D5): {@code staff_id IS NULL}, so they cannot be expressed as a
     * derived query without inventing an {@code IsNull} suffix that reads like a typo. V1 has a
     * partial index for exactly this predicate.
     *
     * <p>Schema verification only, and no production caller by design: {@link #findForEngine} covers
     * the engine and {@link #findByBusinessIdAndDateBetween} the admin calendar. It stays because
     * {@code SchemaMappingIT} is what exercises that partial index, which is otherwise only ever
     * tested implicitly, through {@code findForEngine}'s {@code OR}.
     */
    @Query("""
            select o from AvailabilityOverride o
            where o.businessId = :businessId
              and o.staffId is null
              and o.date between :from and :to
            """)
    List<AvailabilityOverride> findBusinessWideByDateBetween(
            UUID businessId, LocalDate from, LocalDate to);

    /**
     * <b>The engine's one override read</b> (plan 09): the business-wide closures and the candidate
     * staff members' own rows, together, for the whole range.
     *
     * <p>One query and not one per scope, which is the difference between the engine's data load
     * being three statements and being four — the number the plan fixes and the endpoint's query
     * counter asserts. It costs nothing to merge them: {@code business_id} is on every row whichever
     * level it belongs to, so the predicate is one {@code OR} rather than a second round trip, and
     * {@code AvailabilityOverride.isBusinessWide} sorts the results out in memory afterwards.
     *
     * <p>Not a replacement for {@link #findByBusinessIdAndDateBetween}: that one is the admin
     * calendar and wants <em>every</em> staff member's rows, while this one wants only the staff who
     * can perform the service being asked about. Loading the whole tenant's overrides to throw most
     * of them away is exactly the read that gets slower as the business gets busier.
     */
    @Query("""
            select o from AvailabilityOverride o
            where o.businessId = :businessId
              and (o.staffId is null or o.staffId in :staffIds)
              and o.date between :from and :to
            """)
    List<AvailabilityOverride> findForEngine(UUID businessId, Collection<UUID> staffIds,
            LocalDate from, LocalDate to);

    /** The merged admin view: business-wide plus every staff member's (plan 08). */
    List<AvailabilityOverride> findByBusinessIdAndDateBetween(
            UUID businessId, LocalDate from, LocalDate to);

    Optional<AvailabilityOverride> findByIdAndBusinessId(UUID id, UUID businessId);
}
