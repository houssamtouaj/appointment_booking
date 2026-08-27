package com.slotflow.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.slotflow.security.AuthProperties.RefreshCookie;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * The two ways {@code REFRESH_COOKIE_SAME_SITE} can be set wrong, both of which are invisible
 * without this check.
 *
 * <p>A misspelt attribute is written into the header verbatim and every browser quietly falls back
 * to Lax; {@code None} without {@code Secure} produces a cookie every modern browser rejects
 * outright. Either way the service boots, reports itself healthy, and the first symptom is a
 * {@code /api/auth/refresh} that 401s fifteen minutes into a session — long after the deploy that
 * caused it, with nothing in any log naming the cause.
 */
class RefreshCookieSettingsTest {

    @Test
    @DisplayName("a cross-site deployment gets SameSite=None once it is also Secure")
    void noneIsAllowedAlongsideSecure() {
        assertThat(new RefreshCookie(true, "None").sameSite()).isEqualTo("None");
    }

    @Test
    @DisplayName("the default is Lax, which is what a same-site deployment wants")
    void blankFallsBackToLax() {
        assertThat(new RefreshCookie(false, null).sameSite()).isEqualTo("Lax");
        assertThat(new RefreshCookie(false, "  ").sameSite()).isEqualTo("Lax");
    }

    @Test
    @DisplayName("case and whitespace are forgiven, because a deployer types this by hand")
    void valuesAreCanonicalised() {
        assertThat(new RefreshCookie(false, " lax ").sameSite()).isEqualTo("Lax");
        assertThat(new RefreshCookie(true, "none").sameSite()).isEqualTo("None");
    }

    @ParameterizedTest(name = "\"{0}\" is refused")
    @ValueSource(strings = {"Laxx", "no-restriction", "None; Secure", "true"})
    @DisplayName("an attribute no browser understands fails startup rather than degrading silently")
    void unknownAttributesAreRefused(String sameSite) {
        // The message names the environment variable a deployer set, not the Spring property it
        // lands in, because the variable is the only one of the two they have seen.
        assertThatThrownBy(() -> new RefreshCookie(true, sameSite))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("REFRESH_COOKIE_SAME_SITE");
    }

    @Test
    @DisplayName("SameSite=None without Secure is refused, since the browser would drop the cookie")
    void noneWithoutSecureIsRefused() {
        assertThatThrownBy(() -> new RefreshCookie(false, "None"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("REFRESH_COOKIE_SECURE");
    }
}
