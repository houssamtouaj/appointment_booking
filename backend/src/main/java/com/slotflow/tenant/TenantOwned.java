package com.slotflow.tenant;

import java.util.UUID;

/**
 * Implemented by every entity that belongs to exactly one business.
 *
 * <p>It is the type the tenant guard in plan 06 checks against. Without a common interface, the
 * guard would need an overload per entity, and the day someone adds a seventh entity they would
 * simply forget one — which is a silent cross-tenant read, the worst bug this application can
 * have. With it, {@code tenant.requireOwned(entity)} takes anything ownable and there is nothing
 * to forget.
 *
 * <p>{@code Business} implements it by returning its own id, so the guard needs no special case
 * for the tenant root itself.
 *
 * <p>Not implemented by rows that hang off a user rather than a business — working hours, refresh
 * tokens, invitations. Those are reached through their owner, and the guard runs on the owner.
 */
public interface TenantOwned {

    UUID getBusinessId();
}
