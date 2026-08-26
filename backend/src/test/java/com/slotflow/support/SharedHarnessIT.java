package com.slotflow.support;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import javax.sql.DataSource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Tests the harness itself, which is worth doing exactly once: everything from wave 3 onwards
 * inherits from it, so a quiet regression here — a second container, a clock that does not reset —
 * would be paid for by every test in the suite.
 */
class SharedHarnessIT extends IntegrationTest {

    @Autowired
    private DataSource dataSource;

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    @DisplayName("the application is pointed at the singleton container, not one of its own")
    void usesTheSharedContainer() throws Exception {
        assertThat(POSTGRES.isRunning()).isTrue();

        try (var connection = dataSource.getConnection()) {
            // If a subclass ever declares its own @Container, this is what catches it: the URL
            // carries the mapped port, which is unique per container.
            assertThat(connection.getMetaData().getURL()).startsWith(POSTGRES.getJdbcUrl());
        }
    }

    @Test
    @DisplayName("every migration has been applied exactly once, whether or not the container was reused")
    void migrationsRanOnce() {
        // Reuse is enabled locally and ignored in CI, so this has to hold both ways: a fresh
        // container migrates on startup, a reused one already has the history rows.
        //
        // Asserted as "no version appears twice" rather than as a count. A count is a number that
        // has to be edited every time a wave adds a migration, and a test whose expected value is
        // routinely bumped is a test nobody reads before bumping it. What must never happen is a
        // version applied twice, or a failed row left behind - neither of which a count would
        // notice once it had been bumped.
        assertThat(jdbc.queryForObject("""
                SELECT count(*) - count(DISTINCT version) FROM flyway_schema_history
                """, Integer.class))
                .as("a version applied twice")
                .isZero();
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE NOT success", Integer.class))
                .as("a migration left in the history as failed")
                .isZero();
        // V1 is the baseline and stays first: it is immutable, and a later file that sorted ahead
        // of it would run against an empty database and then find the tables already there.
        assertThat(jdbc.queryForObject(
                "SELECT version FROM flyway_schema_history WHERE installed_rank = 1", String.class))
                .isEqualTo("1");
    }

    @Test
    @DisplayName("btree_gist is installed, or the exclusion constraint could not exist")
    void requiredExtensionIsPresent() {
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM pg_extension WHERE extname = 'btree_gist'", Integer.class))
                .isEqualTo(1);
    }

    @Test
    @DisplayName("the injected clock is the movable one, starting at the suite's instant")
    void clockStartsPinned() {
        assertThat(clock.instant()).isEqualTo(TestTime.NOW);
    }

    @Test
    @DisplayName("time travel is possible without restarting the context")
    void clockCanBeMoved() {
        // This is what makes plan 10's expiry sweeper and plan 12's reminder job testable: create a
        // row, jump forward, assert the job sees it. A Thread.sleep would take thirty-one minutes.
        clock.advanceBy(Duration.ofMinutes(31));

        assertThat(clock.instant()).isEqualTo(TestTime.NOW.plus(Duration.ofMinutes(31)));
    }

    @Test
    @DisplayName("the clock is back at the start of every test, so time travel cannot leak")
    void clockResetsBetweenTests() {
        // Whichever order JUnit picks, this test and the one above both see NOW on entry. Without
        // the reset in the base class, one of them would fail and which one would depend on order.
        assertThat(clock.instant()).isEqualTo(TestTime.NOW);

        clock.setTo(Instant.parse("2030-01-01T00:00:00Z"));

        assertThat(clock.instant()).isNotEqualTo(TestTime.NOW);
    }
}
