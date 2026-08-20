package com.slotflow.security;

import java.time.Duration;

/**
 * What login, register and refresh all return.
 *
 * <p><b>There is no refresh token in this body.</b> It leaves in an httpOnly cookie, for the reasons
 * set out in {@link RefreshTokenCookie}; a client that wants to keep a session alive re-posts to
 * {@code /refresh} and lets the browser attach it.
 *
 * @param accessToken the JWT, to be held in memory and sent as {@code Authorization: Bearer}
 * @param tokenType   always {@code Bearer}. Present because every OAuth-shaped client expects it
 * @param expiresIn   seconds, not an instant: the client's clock may be wrong, and a countdown is
 *                    what an Axios interceptor actually needs to schedule a pre-emptive refresh
 * @param user        the caller, so the SPA can render the shell without a second request
 */
public record AuthResponse(
        String accessToken,
        String tokenType,
        long expiresIn,
        MeResponse user) {

    private static final String BEARER = "Bearer";

    public static AuthResponse of(String accessToken, Duration accessTokenTtl, MeResponse user) {
        return new AuthResponse(accessToken, BEARER, accessTokenTtl.toSeconds(), user);
    }
}
