package com.slotflow.security;

import java.time.Duration;

/**
 * What a successful register, login or refresh produces: a body for the client and a refresh token
 * for the {@code Set-Cookie} header.
 *
 * <p>It exists so the service can mint both halves in one transaction while the controller keeps
 * the only knowledge of how a cookie is written. The alternative — a controller that calls the
 * token service itself — would put an issuing decision in the web layer, where it is easy to
 * forget on one of the three paths.
 */
public record AuthSession(AuthResponse tokens, String refreshToken, Duration refreshTokenTtl) {
}
