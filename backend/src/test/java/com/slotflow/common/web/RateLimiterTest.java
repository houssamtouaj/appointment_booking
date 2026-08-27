package com.slotflow.common.web;

import static org.assertj.core.api.Assertions.assertThat;

import com.slotflow.common.web.RateLimitProperties.Limit;
import java.time.Duration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The buckets themselves, against an instance this test owns.
 *
 * <p>{@code RateLimitFilterTest} covers the per-IP budgets through the filter. What is left is the
 * scope no filter can reach: D12's per-guest-email booking budget, which plan 10 enforces inside
 * {@code PublicBookingService} because the key only exists once the request body has been parsed.
 * It is exercised here rather than through the API for a blunt reason — the whole integration suite
 * runs with {@code app.rate-limit.enabled=false}, since the buckets are per process and leaving them
 * on would make the outcome of one test depend on how many requests the previous one made.
 */
class RateLimiterTest {

    private static final Limit ONE_A_MINUTE = new Limit(1, Duration.ofMinutes(1));

    @Test
    @DisplayName("the guest booking budget is per email address, not shared across customers")
    void theGuestBookingBudgetIsPerKey() {
        RateLimiter limiter = limiterAllowing(new Limit(2, Duration.ofHours(1)));

        assertThat(allowed(limiter, "alex@example.test")).isTrue();
        assertThat(allowed(limiter, "alex@example.test")).isTrue();
        assertThat(allowed(limiter, "alex@example.test"))
                .as("the third booking from one address in an hour is the one D12 is about")
                .isFalse();

        assertThat(allowed(limiter, "sam@example.test"))
                .as("and it must not spill onto the next customer through the door")
                .isTrue();
    }

    @Test
    @DisplayName("a rejection says how long to wait, rounded up so an immediate retry is not invited")
    void aRejectionCarriesARetryAfter() {
        RateLimiter limiter = limiterAllowing(ONE_A_MINUTE);
        limiter.tryConsume(RateLimiter.Scope.GUEST_BOOKING, "alex@example.test");

        RateLimiter.Decision refused = limiter.tryConsume(RateLimiter.Scope.GUEST_BOOKING, "alex@example.test");

        assertThat(refused.allowed()).isFalse();
        assertThat(refused.retryAfterSeconds())
                .as("Retry-After: 0 invites a retry that also fails")
                .isBetween(1L, 60L);
    }

    @Test
    @DisplayName("the three scopes are three budgets, even for the same key")
    void scopesDoNotShareABudget() {
        RateLimiter limiter = limiterAllowing(ONE_A_MINUTE);

        // A staff member booking from the office, whose IP is also the key on a public write, must
        // not lose their booking budget to somebody else's password reset.
        assertThat(limiter.tryConsume(RateLimiter.Scope.PUBLIC_WRITE, "same-key").allowed()).isTrue();
        assertThat(limiter.tryConsume(RateLimiter.Scope.GUEST_BOOKING, "same-key").allowed()).isTrue();
        assertThat(limiter.tryConsume(RateLimiter.Scope.LOGIN, "same-key").allowed()).isTrue();

        assertThat(limiter.tryConsume(RateLimiter.Scope.GUEST_BOOKING, "same-key").allowed())
                .isFalse();
    }

    @Test
    @DisplayName("disabled means every request passes, which is what the integration suite relies on")
    void disabledLetsEverythingThrough() {
        RateLimiter limiter = new RateLimiter(
                new RateLimitProperties(false, ONE_A_MINUTE, ONE_A_MINUTE, ONE_A_MINUTE));

        for (int attempt = 0; attempt < 5; attempt++) {
            assertThat(allowed(limiter, "alex@example.test")).isTrue();
        }
    }

    private static RateLimiter limiterAllowing(Limit guestBooking) {
        return new RateLimiter(
                new RateLimitProperties(true, ONE_A_MINUTE, ONE_A_MINUTE, guestBooking));
    }

    private static boolean allowed(RateLimiter limiter, String email) {
        return limiter.tryConsume(RateLimiter.Scope.GUEST_BOOKING, email).allowed();
    }
}
