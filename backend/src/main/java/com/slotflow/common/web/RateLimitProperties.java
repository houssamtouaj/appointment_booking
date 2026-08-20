package com.slotflow.common.web;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The three rate limits from D12, in configuration rather than in constants, so a load test or
 * a demo walkthrough can loosen them without a rebuild.
 *
 * @param enabled     off in most tests: a shared bucket makes test order significant
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
        login = login != null ? login : new Limit(10, Duration.ofMinutes(1));
        publicWrite = publicWrite != null ? publicWrite : new Limit(10, Duration.ofMinutes(1));
        guestBooking = guestBooking != null ? guestBooking : new Limit(5, Duration.ofHours(1));
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
