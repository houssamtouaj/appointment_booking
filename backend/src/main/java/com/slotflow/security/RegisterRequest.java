package com.slotflow.security;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Sign-up: one request that creates a business, its default booking policy and its owner.
 *
 * @param businessName what customers see on the booking page
 * @param slug         the public URL segment, immutable afterwards. Validated case-insensitively
 *                     because {@code Business} lower-cases before it checks the plan-02 regex, so
 *                     "Dana-Clinic" is a usable answer rather than a validation error
 * @param timezone     IANA zone id; parsed in the service, where an unknown zone becomes a 422
 *                     naming the field
 * @param currency     ISO 4217, upper case
 * @param fullName     the owner's name
 * @param email        the owner's login, globally unique (D13)
 * @param password     see {@link Passwords} for why the maximum is 72 <em>bytes</em> and not
 *                     72 characters
 */
public record RegisterRequest(

        @NotBlank @Size(max = 120)
        @Schema(example = "Dana Clinic")
        String businessName,

        @NotBlank
        @Pattern(regexp = "^[A-Za-z0-9-]{3,40}$",
                message = "must be 3-40 letters, digits or hyphens")
        @Schema(example = "dana-clinic")
        String slug,

        @NotBlank @Size(max = 64)
        @Schema(example = "Europe/Paris")
        String timezone,

        @NotBlank
        @Pattern(regexp = "^[A-Za-z]{3}$", message = "must be a three-letter ISO 4217 code")
        @Schema(example = "EUR")
        String currency,

        @NotBlank @Size(max = 120)
        @Schema(example = "Dana Okoye")
        String fullName,

        @NotBlank @Email @Size(max = 320)
        @Schema(example = "dana@example.com")
        String email,

        @NotBlank @Password
        @Schema(description = Passwords.SCHEMA_DESCRIPTION, example = "correct-horse-battery")
        String password) {
}
