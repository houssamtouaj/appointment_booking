package com.slotflow.business;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * The policy's id <em>is</em> its business id, so {@code findById(businessId)} is the tenant-scoped
 * lookup and there is no separate {@code findByBusinessId} to keep in step with it.
 */
public interface BookingPolicyRepository extends JpaRepository<BookingPolicy, UUID> {}
