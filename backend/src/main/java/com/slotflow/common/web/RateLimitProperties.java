package com.slotflow.common.web;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The three rate limits from D12, in configuration rather than in constants, so a load test or
 * a demo walkthrough can loosen them without a rebuild.
 *
 * <p>No fallback values in the constructor, deliberately. The budgets are written down once, in
 * {@code application.yml}, next to the comment that explains them. A second copy here would mean
 * tuning the yaml leaves the code stating last month's numbers, and an environment that omits a
 * block would silently get the stale copy instead of refusing to start.
 *
 * @param enabled     switched off for the whole integration suite (see {@code IntegrationTest}):
 *                    the buckets are per process and keyed by IP, so leaving them on would make
 *                    test order significant
 * @param login       per client IP on the login endpoint
 * @param publicWrite per client IP on every other unauthenticated write
 * @param guestBooking per guest email address, enforced by plan 10's booking service rather
 *                     than by the filter, because the email is in the request body
 */
@ConfigurationProperties(prefix = "app.rate-limit")
public record RateLimitProperties(
        boolean enabled,
        Limit login,
        Limit publicWrite,
        Limit guestBooking) {

    public RateLimitProperties {
        requireConfigured(login, "app.rate-limit.login");
        requireConfigured(publicWrite, "app.rate-limit.public-write");
        requireConfigured(guestBooking, "app.rate-limit.guest-booking");
    }

    private static void requireConfigured(Limit limit, String property) {
        if (limit == null) {
            throw new IllegalArgumentException(property + " must be configured");
        }
    }

    /**
     * {@code capacity} requests per {@code window}, refilled smoothly rather than in one jump
     * at the end of the window: a caller that waits a sixth of the window gets a sixth of the
     * budget back, instead of everyone retrying against the same cliff.
     */
    public record Limit(int capacity, Duration window) {

        public Limit {
            if (capacity < 1) {
                throw new IllegalArgumentException("rate limit capacity must be at least 1");
            }
            if (window == null || window.isZero() || window.isNegative()) {
                throw new IllegalArgumentException("rate limit window must be positive");
            }
        }
    }
}
