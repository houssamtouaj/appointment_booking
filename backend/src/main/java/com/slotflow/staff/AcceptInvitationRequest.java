package com.slotflow.staff;

import com.slotflow.security.Password;
import com.slotflow.security.Passwords;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Accepting an invitation: the invitee's own name, and the password that activates the account.
 * Same length rules as every other password in the system ({@link Passwords}).
 *
 * <p>This is the one of the three where getting the rule wrong is worst. An invitee who chooses a
 * long passphrase in their own alphabet cannot retry against a 500 — they have one link, and no
 * account to sign in and complain from.
 */
public record AcceptInvitationRequest(

        @NotBlank @Size(max = 120) String fullName,

        @NotBlank @Password String password) {
}
