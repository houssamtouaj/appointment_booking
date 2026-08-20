package com.slotflow.staff;

import jakarta.validation.constraints.Size;

/**
 * A partial update: every field is optional and {@code null} means "leave it alone".
 *
 * <p>Which fields a caller is allowed to send depends on who they are, and that is enforced in the
 * service rather than by two request types — an owner may change all three, a staff member may
 * change their own name and nothing else. A staff member who sends {@code role} or {@code active}
 * gets a 403 rather than having it quietly ignored: silently dropping part of a request is how a
 * client comes to believe something was saved.
 */
public record UpdateStaffRequest(

        @Size(min = 1, max = 120) String fullName,

        Role role,

        Boolean active) {

    public boolean changesPrivilegedFields() {
        return role != null || active != null;
    }
}
