package com.slotflow.availability;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * The weekly template.
 *
 * <p>{@link #findByStaffIdIn} is the one the engine calls: one query for every candidate staff
 * member and every day of the requested range, because the alternative — a query per staff member
 * per date — is a thirty-fold N+1 that only shows up once the demo has real data in it.
 */
public interface WorkingHoursRepository extends JpaRepository<WorkingHours, UUID> {

    List<WorkingHours> findByStaffIdIn(Collection<UUID> staffIds);

    List<WorkingHours> findByStaffId(UUID staffId);

    /** Plan 08 replaces the whole week on {@code PUT}, rather than patching row by row. */
    void deleteByStaffId(UUID staffId);
}
