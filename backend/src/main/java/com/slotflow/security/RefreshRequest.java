package com.slotflow.security;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Size;

/**
 * The optional body of {@code /refresh} and {@code /logout}.
 *
 * <p>The cookie is the transport ({@link RefreshTokenCookie}); this field is the non-browser escape
 * hatch, and the only way to present a <em>specific</em> token — which is what proving reuse
 * detection requires, since a browser has by definition thrown the old value away.
 */
public record RefreshRequest(

        @Size(max = 200)
        @Schema(description = "Only for non-browser clients; browsers send the httpOnly cookie",
                nullable = true) String refreshToken) {
}
