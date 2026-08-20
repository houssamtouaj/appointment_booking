package com.slotflow.support;

import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.TestPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * Base class for every integration test: one Postgres container, one Spring context, one movable
 * clock.
 *
 * <h2>Why the container is started in a static initialiser</h2>
 * This is the decision plan 14 says is worth getting right on day one, and it is easy to get
 * wrong in a way that still passes. The obvious spelling —
 * {@code @Testcontainers} plus {@code @Container} — hands the lifecycle to JUnit, which starts the
 * container before the first test <em>of each class</em> and stops it after the last. Shared
 * through a base class that means: start, stop, start again, stop again, once per test class.
 * Postgres takes a couple of seconds to boot, so a forty-second suite becomes an eight-minute one
 * and nothing fails to tell you.
 *
 * <p>A static initialiser runs exactly once per JVM. Nothing stops the container afterwards;
 * Testcontainers' own shutdown hook does that when the fork exits. {@code @ServiceConnection}
 * points {@code spring.datasource.*} at it, and Boot finds the annotated field on this superclass,
 * so a subclass needs no annotation of its own beyond whatever it adds.
 *
 * <h2>Reuse</h2>
 * {@code withReuse(true)} keeps the container alive between local runs, which turns the
 * second {@code mvn verify} of an afternoon into a fast one. It requires
 * {@code testcontainers.reuse.enable=true} in {@code ~/.testcontainers.properties} and is ignored
 * in CI, so the suite has to be correct both ways: <b>every test creates its own tenant</b> and
 * asserts only on rows it inserted. No test may count rows in a whole table, and none may assume
 * an empty database.
 *
 * <h2>Rate limiting is off</h2>
 * The buckets are per process and keyed by IP, so with the limiter on, which test in a class is
 * the eleventh login would depend on execution order. It is switched off here rather than in the
 * MockMvc subclass so that what {@code RateLimitProperties} says about the test suite is true of
 * all of it. {@code RateLimitFilterTest} covers the limiter itself against its own instance, where
 * the assertions can be exact.
 *
 * <h2>One context</h2>
 * Subclasses that add no context configuration of their own share a single application context,
 * because Spring caches contexts by configuration. That is why the clock is here rather than in
 * each test: a per-class {@code @TestConfiguration} pinning a different instant would fork the
 * cache and pay for a fresh context every time.
 */
@SpringBootTest
// A nested @TestConfiguration is auto-detected on the test class itself, but not on a superclass:
// Spring scans the concrete class's own declared classes and stops there. Naming it explicitly is
// what makes it apply to every subclass. Boot still merges in @SpringBootApplication, because a
// @ContextConfiguration listing only @TestConfiguration classes is treated as additive rather than
// as a replacement for the application's own configuration.
@ContextConfiguration(classes = IntegrationTest.ClockOverride.class)
@TestPropertySource(properties = "app.rate-limit.enabled=false")
public abstract class IntegrationTest {

    /**
     * Pinned to a specific minor version rather than {@code postgres:16}. The exclusion constraint
     * and {@code btree_gist} are the load-bearing part of this schema, and "it worked last month"
     * is not a useful thing to hear about a database upgrade nobody chose.
     */
    private static final String POSTGRES_IMAGE = "postgres:16-alpine";

    @ServiceConnection
    protected static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(POSTGRES_IMAGE).withReuse(true);

    static {
        POSTGRES.start();
    }

    /**
     * The application's {@code Clock}, movable. Use it instead of waiting: a test with a
     * {@code Thread.sleep} in it is a future flake.
     */
    @Autowired
    protected MutableClock clock;

    @BeforeEach
    void resetTheClock() {
        clock.reset();
    }

    @TestConfiguration
    static class ClockOverride {

        @Bean
        @Primary
        MutableClock testClock() {
            return MutableClock.startingAtTestTime();
        }
    }
}
