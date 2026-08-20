package com.slotflow.staff;

import java.util.UUID;

/**
 * D9: who a customer can book with. An id and a display name, and deliberately nothing else.
 *
 * <p>Written by hand rather than derived from {@link StaffResponse}, which plan 06 calls for
 * explicitly and which is worth the duplication. Reusing the admin record on a public endpoint
 * publishes every field it ever grows — an email address today, an {@code active} flag and a role
 * tomorrow — and the leak arrives through a change to a class nobody was thinking about at the time.
 * Two records mean the public shape can only change on purpose.
 *
 * @param displayName the staff member's full name. Named for what it is to a customer, not for the
 *                    column it comes from
 */
public record PublicStaffResponse(UUID id, String displayName) {
}
