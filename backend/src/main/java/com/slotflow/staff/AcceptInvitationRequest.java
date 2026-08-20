package com.slotflow.staff;

import com.slotflow.security.Passwords;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Accepting an invitation: the invitee's own name, and the password that activates the account.
 * Same length rules as every other password in the system ({@link Passwords}).
 */
public record AcceptInvitationRequest(

        @NotBlank @Size(max = 120) String fullName,

        @NotBlank @Size(min = Passwords.MIN_LENGTH, max = Passwords.MAX_LENGTH,
                message = Passwords.SIZE_MESSAGE)
        String password) {
}
