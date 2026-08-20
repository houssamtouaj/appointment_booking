package com.slotflow.security;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Note what is <em>not</em> validated: the password has no {@code @Size} and the email has no
 * {@code @Email}. A login form must not tell a caller that a stored password is too short to be
 * one of ours, or that an address is not one we would have accepted — both are the same
 * enumeration oracle the identical-error rule exists to close. The only rejections here are for
 * bodies that carry nothing at all.
 */
public record LoginRequest(

        @NotBlank @Size(max = 320) String email,

        @NotBlank @Size(max = 200) String password) {
}
