package com.slotflow.common.web;

import io.github.bucket4j.Bucket;
import io.github.bucket4j.ConsumptionProbe;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * The token buckets behind D12, keyed by scope and by whatever identifies the caller.
 *
 * <p>In-memory and therefore per-instance: two API containers mean two independent budgets.
 * That is an honest trade for a single-instance demo and it is written down in the README, next
 * to the note that a real deployment moves this to {@code bucket4j-redis} and changes nothing
 * else. The interface below is deliberately the one a distributed implementation would also
 * satisfy.
 *
 * <p>Separate from {@link RateLimitFilter} because not every limit can live in a filter: the
 * per-email booking limit (D12) needs the parsed request body, so plan 10's booking service
 * calls {@link #tryConsume} directly with {@link Scope#GUEST_BOOKING}.
 */
@Component
public class RateLimiter {

    private static final Logger log = LoggerFactory.getLogger(RateLimiter.class);

    /** What is being limited. Each scope gets its own bucket per key, never a shared budget. */
    public enum Scope {
        /** Per client IP, on login only, so credential stuffing cannot hide in ordinary traffic. */
        LOGIN,
        /** Per client IP, on unauthenticated writes: registration, booking, cancellation. */
        PUBLIC_WRITE,
        /** Per guest email, on booking creation. Enforced in the service, not the filter. */
        GUEST_BOOKING
    }

    /**
     * @param allowed    whether the caller may proceed
     * @param retryAfter how long until one token is available; {@link Duration#ZERO} when allowed
     */
    public record Decision(boolean allowed, Duration retryAfter) {

        static Decision pass() {
            return new Decision(true, Duration.ZERO);
        }

        /** Rounded up: a {@code Retry-After: 0} invites an immediate retry that also fails. */
        static Decision reject(long nanosToWait) {
            long seconds = Math.max(1L, (nanosToWait + 999_999_999L) / 1_000_000_000L);
            return new Decision(false, Duration.ofSeconds(seconds));
        }

        /** Seconds, which is what the {@code Retry-After} header is measured in. */
        public long retryAfterSeconds() {
            return retryAfter.toSeconds();
        }
    }

    private final RateLimitProperties properties;
    private final Map<String, Bucket> buckets = new ConcurrentHashMap<>();

    public RateLimiter(RateLimitProperties properties) {
        this.properties = properties;
    }

    /**
     * Takes one token for {@code key} in {@code scope}.
     *
     * @param key an IP address or an email address; never a user-controlled string that is
     *            unbounded in cardinality, or the map below becomes the denial of service
     */
    public Decision tryConsume(Scope scope, String key) {
        if (!properties.enabled()) {
            return Decision.pass();
        }
        ConsumptionProbe probe = buckets
                .computeIfAbsent(scope + "|" + key, ignored -> newBucket(scope))
                .tryConsumeAndReturnRemaining(1);
        if (probe.isConsumed()) {
            return Decision.pass();
        }
        log.debug("Rate limit hit: scope={} key={}", scope, key);
        return Decision.reject(probe.getNanosToWaitForRefill());
    }

    private Bucket newBucket(Scope scope) {
        RateLimitProperties.Limit limit = limitFor(scope);
        return Bucket.builder()
                .addLimit(bandwidth -> bandwidth
                        .capacity(limit.capacity())
                        .refillGreedy(limit.capacity(), limit.window()))
                .build();
    }

    private RateLimitProperties.Limit limitFor(Scope scope) {
        return switch (scope) {
            case LOGIN -> properties.login();
            case PUBLIC_WRITE -> properties.publicWrite();
            case GUEST_BOOKING -> properties.guestBooking();
        };
    }

    /**
     * Drops buckets that are back at full capacity, which is exactly the set that would answer
     * the next request identically to a brand new one. Without this the map grows once per
     * distinct IP forever, which is a slow leak on a public endpoint.
     */
    @Scheduled(fixedDelay = 5, timeUnit = TimeUnit.MINUTES)
    void evictIdleBuckets() {
        int before = buckets.size();
        buckets.entrySet().removeIf(entry ->
                entry.getValue().getAvailableTokens() >= capacityOf(entry.getKey()));
        if (before != buckets.size()) {
            log.debug("Evicted {} idle rate-limit buckets, {} remain", before - buckets.size(), buckets.size());
        }
    }

    private long capacityOf(String compositeKey) {
        Scope scope = Scope.valueOf(compositeKey.substring(0, compositeKey.indexOf('|')));
        return limitFor(scope).capacity();
    }

    /** Test seam: forget every bucket so one test's traffic cannot fail the next one. */
    public void reset() {
        buckets.clear();
    }
}
