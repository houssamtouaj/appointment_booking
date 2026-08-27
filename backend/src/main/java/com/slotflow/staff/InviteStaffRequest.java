package com.slotflow.staff;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Invite a colleague.
 *
 * @param fullName the owner's guess at the name; the invitee's own answer replaces it on accept
 * @param role     a parameter because an owner may legitimately invite a co-owner
 */
public record InviteStaffRequest(

        @NotBlank @Email @Size(max = 320)
        @Schema(example = "sam@example.com") String email,

        @NotBlank @Size(max = 120)
        @Schema(example = "Sam Ferreira") String fullName,

        @NotNull
        @Schema(example = "STAFF") Role role) {
}
