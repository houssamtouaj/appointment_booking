package com.slotflow.availability;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

/**
 * The weekly template.
 *
 * <p>{@link #findForStaff} is the one the engine calls: one query for every candidate staff
 * member and every day of the requested range, because the alternative — a query per staff member
 * per date — is a thirty-fold N+1 that only shows up once the demo has real data in it.
 */
public interface WorkingHoursRepository extends JpaRepository<WorkingHours, UUID> {

    /**
     * The whole team's template in one query. Empty in, empty out, without a round trip: the same
     * guard {@code BookingRepository.findActiveForStaffBetween} carries, for the same reason.
     */
    default List<WorkingHours> findForStaff(Collection<UUID> staffIds) {
        return staffIds.isEmpty() ? List.of() : findByStaffIdIn(staffIds);
    }

    List<WorkingHours> findByStaffIdIn(Collection<UUID> staffIds);

    List<WorkingHours> findByStaffId(UUID staffId);

    /**
     * Plan 08 replaces the whole week on {@code PUT}, rather than patching row by row.
     *
     * <p>Spelled out as a bulk {@code delete} rather than left to Spring Data's derived form.
     * A derived {@code deleteBy…} is neither transactional nor modifying on its own — the first
     * caller outside a transaction gets {@code TransactionRequiredException} — and it deletes by
     * loading every matching row and removing them one at a time. {@code clearAutomatically}
     * because this runs immediately before the replacement rows are saved, and the emptied
     * persistence context must not still hold the ones the query just deleted.
     *
     * <p>{@code flushAutomatically} is the other half of that, and it is not optional: clearing a
     * persistence context <em>discards</em> whatever was still pending in it. Without the flush, any
     * caller that had modified an entity before calling this would watch that change vanish with no
     * error anywhere — which is the failure mode Spring Data's own documentation warns about, and it
     * belongs on the method rather than in a note every future caller has to have read.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query("delete from WorkingHours w where w.staffId = :staffId")
    int deleteByStaffId(UUID staffId);
}
