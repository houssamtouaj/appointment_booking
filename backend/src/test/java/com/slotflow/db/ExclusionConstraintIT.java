package com.slotflow.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Proves the claim the README makes: overlapping bookings are impossible, and the database
 * is what makes them impossible.
 *
 * <p>Everything here goes through raw SQL on purpose. There are no entities yet, and more
 * importantly the guarantee under test belongs to Postgres — running it through JPA would
 * only test JPA. The container starts from an empty volume, so V1 has to apply cleanly
 * before a single assertion runs.
 *
 * <p>The interesting case is {@link #rejectsAnOverlapThatIsOnlyInTheBuffers()}: the two
 * appointments do not touch, and the booking is still refused, because the constraint ranges
 * over the buffer-expanded window (D4) — the same rule the availability engine applies.
 */
@SpringBootTest
@Testcontainers
class ExclusionConstraintIT {

    /** SQLSTATE for exclusion_violation. */
    private static final String EXCLUSION_VIOLATION = "23P01";

    /** A Monday morning, fixed so failures read the same on every machine. */
    private static final Instant NINE_AM = Instant.parse("2026-03-02T09:00:00Z");

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired
    private JdbcTemplate jdbc;

    private UUID businessId;
    private UUID staffId;
    private UUID colleagueId;
    private UUID serviceId;

    /** A fresh tenant per test, so no test can pass because of another one's rows. */
    @BeforeEach
    void seedTenant() {
        businessId = UUID.randomUUID();
        staffId = UUID.randomUUID();
        colleagueId = UUID.randomUUID();
        serviceId = UUID.randomUUID();

        jdbc.update("""
                INSERT INTO business (id, slug, name, timezone, currency)
                VALUES (?, ?, ?, ?, ?)
                """, businessId, slug(), "Test Clinic", "Europe/Paris", "EUR");

        insertStaff(staffId, "Dana Okoye");
        insertStaff(colleagueId, "Sam Ferreira");

        jdbc.update("""
                INSERT INTO service_offering
                    (id, business_id, name, duration_minutes, price_cents,
                     buffer_before_minutes, buffer_after_minutes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, serviceId, businessId, "Consultation", 60, 5000L, 10, 10);
    }

    @Test
    @DisplayName("a second booking overlapping a CONFIRMED one is rejected by the database")
    void rejectsAnOverlappingBooking() {
        insertBooking(staffId, "CONFIRMED", NINE_AM, 60, 0, 0);

        assertThatThrownBy(() -> insertBooking(staffId, "CONFIRMED", NINE_AM.plus(30, ChronoUnit.MINUTES), 60, 0, 0))
                .isInstanceOf(DataIntegrityViolationException.class)
                .satisfies(thrown -> assertThat(sqlStateOf(thrown)).isEqualTo(EXCLUSION_VIOLATION));

        assertThat(activeBookingCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("D4: appointments that do not overlap are still rejected when their buffers do")
    void rejectsAnOverlapThatIsOnlyInTheBuffers() {
        // 09:00-10:00 with a 10 minute cleanup buffer -> the calendar loses 08:50-10:10.
        insertBooking(staffId, "CONFIRMED", NINE_AM, 60, 10, 10);

        // 10:05-11:05 with a 10 minute setup buffer -> needs 09:55-11:15.
        Instant fiveMinutesAfter = NINE_AM.plus(65, ChronoUnit.MINUTES);

        // The appointments themselves are five minutes apart: without D4 this would be
        // accepted by the database and then rejected by the engine, which is exactly the
        // race the constraint exists to close.
        assertThat(rangesOverlap(NINE_AM, NINE_AM.plus(60, ChronoUnit.MINUTES),
                fiveMinutesAfter, fiveMinutesAfter.plus(60, ChronoUnit.MINUTES)))
                .as("the raw appointment windows must not overlap, or this test proves nothing")
                .isFalse();

        assertThatThrownBy(() -> insertBooking(staffId, "CONFIRMED", fiveMinutesAfter, 60, 10, 10))
                .isInstanceOf(DataIntegrityViolationException.class)
                .satisfies(thrown -> assertThat(sqlStateOf(thrown)).isEqualTo(EXCLUSION_VIOLATION));

        assertThat(activeBookingCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("a CANCELLED booking releases its slot, so the same time can be booked again")
    void ignoresCancelledBookings() {
        UUID cancelled = insertBooking(staffId, "CONFIRMED", NINE_AM, 60, 10, 10);
        jdbc.update("UPDATE booking SET status = 'CANCELLED' WHERE id = ?", cancelled);

        assertThatCode(() -> insertBooking(staffId, "CONFIRMED", NINE_AM, 60, 10, 10))
                .doesNotThrowAnyException();

        assertThat(activeBookingCount()).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM booking WHERE staff_id = ?", Integer.class, staffId))
                .isEqualTo(2);
    }

    @Test
    @DisplayName("PENDING holds the slot too: a deposit in flight is not a free calendar")
    void pendingBookingsAlsoBlock() {
        insertBooking(staffId, "PENDING", NINE_AM, 60, 0, 0);

        assertThatThrownBy(() -> insertBooking(staffId, "CONFIRMED", NINE_AM, 60, 0, 0))
                .isInstanceOf(DataIntegrityViolationException.class)
                .satisfies(thrown -> assertThat(sqlStateOf(thrown)).isEqualTo(EXCLUSION_VIOLATION));
    }

    @Test
    @DisplayName("the constraint is per staff member, not per business")
    void allowsTheSameSlotForAnotherStaffMember() {
        insertBooking(staffId, "CONFIRMED", NINE_AM, 60, 10, 10);

        assertThatCode(() -> insertBooking(colleagueId, "CONFIRMED", NINE_AM, 60, 10, 10))
                .doesNotThrowAnyException();

        assertThat(activeBookingCount()).isEqualTo(2);
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    /**
     * Inserts a booking the way plan 10 will: the blocked window is the appointment widened
     * by the buffers snapshotted onto the row (D14), computed by the caller because
     * {@code timestamptz - interval} is not IMMUTABLE and so cannot be a generated column.
     */
    private UUID insertBooking(UUID staff, String status, Instant startsAt,
                               int durationMinutes, int bufferBefore, int bufferAfter) {
        UUID id = UUID.randomUUID();
        Instant endsAt = startsAt.plus(durationMinutes, ChronoUnit.MINUTES);

        jdbc.update("""
                INSERT INTO booking
                    (id, business_id, service_id, staff_id, guest_name, guest_email,
                     starts_at, ends_at, blocked_from, blocked_to, status, price_cents,
                     buffer_before_minutes, buffer_after_minutes, cancellation_token)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                id, businessId, serviceId, staff, "Alex Guest", "guest@example.test",
                utc(startsAt), utc(endsAt),
                utc(startsAt.minus(bufferBefore, ChronoUnit.MINUTES)),
                utc(endsAt.plus(bufferAfter, ChronoUnit.MINUTES)),
                status, 5000L, bufferBefore, bufferAfter, UUID.randomUUID());
        return id;
    }

    private void insertStaff(UUID id, String fullName) {
        jdbc.update("""
                INSERT INTO app_user (id, business_id, email, full_name, role)
                VALUES (?, ?, ?, ?, 'STAFF')
                """, id, businessId, "staff-" + id + "@example.test", fullName);
    }

    /** Asks Postgres itself whether two windows overlap, so the assertion uses the same
     *  operator the constraint does rather than a Java reimplementation of it. */
    private boolean rangesOverlap(Instant aStart, Instant aEnd, Instant bStart, Instant bEnd) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT tstzrange(?, ?) && tstzrange(?, ?)", Boolean.class,
                utc(aStart), utc(aEnd), utc(bStart), utc(bEnd)));
    }

    private int activeBookingCount() {
        Integer count = jdbc.queryForObject("""
                SELECT count(*) FROM booking
                WHERE business_id = ? AND status IN ('PENDING', 'CONFIRMED')
                """, Integer.class, businessId);
        return count == null ? 0 : count;
    }

    /** Slugs are constrained to lowercase and URL-safe; a uuid fragment satisfies both. */
    private static String slug() {
        return ("biz-" + UUID.randomUUID()).substring(0, 20);
    }

    private static OffsetDateTime utc(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    private static String sqlStateOf(Throwable thrown) {
        Throwable cause = thrown instanceof DataAccessException dae
                ? dae.getMostSpecificCause()
                : thrown;
        return cause instanceof SQLException sql ? sql.getSQLState() : null;
    }
}
