package com.slotflow.staff;

/**
 * Who a user is inside their business. Two values, and that is the whole security matrix.
 *
 * <p>The class diagram had a third, {@code CUSTOMER}, and D1 cut it. Nothing in the brief could
 * reach it: there is no customer registration endpoint, no customer screen, and every booking is
 * a guest booking identified by its cancellation token. Keeping it would have meant a nullable
 * {@code business_id}, an extra branch in every authorisation check, and a role no request could
 * ever carry.
 *
 * <p>Stored as the string name (never the ordinal), so reordering these constants cannot silently
 * promote every staff member to owner.
 */
public enum Role {

    /** Full control of the tenant: staff, services, hours, policy, business settings. */
    OWNER,

    /** Their own calendar and their own working hours, plus read access to the tenant's data. */
    STAFF
}
