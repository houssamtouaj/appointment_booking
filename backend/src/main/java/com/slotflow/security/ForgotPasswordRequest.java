package com.slotflow.security;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * D6. Answered with {@code 202} whether or not the address exists, so there is deliberately no
 * {@code @Email} here either: a 422 for a malformed address and a 202 for a well-formed unknown one
 * is still a signal, just a quieter one.
 */
public record ForgotPasswordRequest(@NotBlank @Size(max = 320) String email) {
}
