package com.slotflow.security;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** The token comes from the emailed link; the password is subject to {@link Passwords}. */
public record ResetPasswordRequest(

        @NotBlank @Size(max = 200) String token,

        @NotBlank @Size(min = Passwords.MIN_LENGTH, max = Passwords.MAX_LENGTH,
                message = Passwords.SIZE_MESSAGE)
        String password) {
}
