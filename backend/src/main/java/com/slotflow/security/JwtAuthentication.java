package com.slotflow.security;

import java.util.List;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

/**
 * The {@code Authentication} a verified access token becomes.
 *
 * <p>A dedicated type rather than a {@code UsernamePasswordAuthenticationToken} with a null
 * password: nothing here was ever authenticated by a password, the credentials are gone by
 * construction, and the principal is an {@link AuthPrincipal} rather than a username. Code that
 * reads {@code getPrincipal()} can cast without wondering.
 */
public final class JwtAuthentication extends AbstractAuthenticationToken {

    private final AuthPrincipal principal;

    public JwtAuthentication(AuthPrincipal principal) {
        super(List.of(new SimpleGrantedAuthority(principal.authority())));
        this.principal = principal;
        // Authenticated at construction, because there is nothing left to check: the signature was
        // verified before this object existed, and there is no provider to hand it to.
        setAuthenticated(true);
    }

    @Override
    public AuthPrincipal getPrincipal() {
        return principal;
    }

    /** Nothing to hold: the token is not kept after it has been verified. */
    @Override
    public Object getCredentials() {
        return null;
    }

    /** What lands in an audit log or an {@code AccessDeniedException} message. */
    @Override
    public String getName() {
        return principal.userId().toString();
    }
}
