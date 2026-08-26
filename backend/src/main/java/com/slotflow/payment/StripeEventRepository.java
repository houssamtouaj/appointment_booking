package com.slotflow.payment;

import org.springframework.data.jpa.repository.JpaRepository;

/**
 * The replay guard, as a repository.
 *
 * <p>Two methods and no queries of its own. {@code existsById} is the fast path — Stripe's retries
 * mostly arrive minutes apart, so the common duplicate is caught by a read — and
 * {@code saveAndFlush} is the correct one: it puts the {@code INSERT} inside the caller's
 * {@code try}, where a duplicate key raised by two deliveries racing in the same second can be
 * caught and treated as what it is. A plain {@code save} would leave the statement in the
 * persistence context until commit, outside every {@code catch}, and the race would surface as a
 * 500 to Stripe — which would then retry it.
 */
public interface StripeEventRepository extends JpaRepository<StripeEvent, String> {
}
