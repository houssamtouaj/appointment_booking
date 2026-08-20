package com.slotflow.catalog;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

/** Tenant-scoped catalog reads. The admin list is paginated; the public list never is — a business
 *  with two hundred bookable services does not exist, and a landing page wants all of them. */
public interface ServiceOfferingRepository extends JpaRepository<ServiceOffering, UUID> {

    Page<ServiceOffering> findByBusinessId(UUID businessId, Pageable pageable);

    /** Backs {@code ?active=} on the admin list (plan 07). */
    Page<ServiceOffering> findByBusinessIdAndActive(UUID businessId, boolean active, Pageable pageable);

    /** The public list. Deactivated services disappear from it immediately. */
    List<ServiceOffering> findByBusinessIdAndActiveTrue(UUID businessId);

    Optional<ServiceOffering> findByIdAndBusinessId(UUID id, UUID businessId);
}
