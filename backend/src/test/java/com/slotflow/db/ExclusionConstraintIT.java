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
import com.slotflow.support.IntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Proves the claim the README makes: overlapping bookings are impossible, and the database
 * is what makes them impossible.
 *
 * <p>Everything here goes through raw SQL on purpose, and it stays that way now that the entities
 * from plan 03 exist: the guarantee under test belongs to Postgres, and routing it through JPA
 * would only prove that Hibernate can build an INSERT. The one thing this test must not depend on
 * is any application code being correct.
 *
 * <p>The interesting case is {@link #rejectsAnOverlapThatIsOnlyInTheBuffers()}: the two
 * appointments do not touch, and the booking is still refused, because the constraint ranges
 * over the buffer-expanded window (D4) — the same rule the availability engine applies.
 *
 * <p>Three of these tests guard the constraints that make that guarantee trustworthy rather than
 * the exclusion constraint itself. {@link #rejectsABlockedRangeThatIgnoresItsOwnBuffers()} is the
 * important one: every other test here computes the blocked window with {@link #insertBooking},
 * so a caller that snapshotted buffers but stored the raw appointment would satisfy the exclusion
 * constraint and quietly hand back the buffer-overlap this file claims is impossible. That case
 * inserts the bad row directly, which is the only way to prove the database refuses it.
 */
class ExclusionConstraintIT extends IntegrationTest {

    /** SQLSTATE for exclusion_violation. */
    private static final String EXCLUSION_VIOLATION = "23P01";

    /** SQLSTATE for check_violation. */
    private static final String CHECK_VIOLATION = "23514";

    /** A Monday morning, fixed so failures read the same on every machine. */
    private static final Instant NINE_AM = Instant.parse("2026-03-02T09:00:00Z");

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
    @DisplayName("back-to-back is legal: blocked ranges that touch at an instant do not overlap")
    void allowsBookingsWhoseBlockedRangesMerelyTouch() {
        // 09:00-10:00 + 10 minutes of cleanup -> the calendar loses 08:50-10:10.
        insertBooking(staffId, "CONFIRMED", NINE_AM, 60, 10, 10);

        // 10:20-11:20 with 10 minutes of setup -> needs 10:10-11:30, starting at the exact
        // instant the first booking's block ends.
        Instant nextSlot = NINE_AM.plus(80, ChronoUnit.MINUTES);

        assertThat(rangesOverlap(NINE_AM.minus(10, ChronoUnit.MINUTES),
                NINE_AM.plus(70, ChronoUnit.MINUTES),
                nextSlot.minus(10, ChronoUnit.MINUTES),
                nextSlot.plus(70, ChronoUnit.MINUTES)))
                .as("the two blocked windows must touch and not overlap, or this test proves nothing")
                .isFalse();

        // tstzrange is half-open by default, so [08:50,10:10) and [10:10,11:30) do not overlap.
        // Written as '[]' instead, every back-to-back pair the engine offers would fail with
        // 23P01 at insert time — and no other test here would notice, because no other test
        // places two bookings whose blocked windows merely meet.
        assertThatCode(() -> insertBooking(staffId, "CONFIRMED", nextSlot, 60, 10, 10))
                .doesNotThrowAnyException();

        assertThat(activeBookingCount()).isEqualTo(2);
    }

    @Test
    @DisplayName("D4: a blocked range that ignores the buffers on its own row is refused")
    void rejectsABlockedRangeThatIgnoresItsOwnBuffers() {
        // Records a 10 minute buffer on each side, then stores the unwidened appointment as the
        // blocked window — the mistake plan 10 can make in one forgotten line. It has to fail
        // here, because booking_no_overlap would otherwise range over 09:00-10:00 and accept a
        // booking starting at 10:01, which is exactly the buffer overlap D4 forbids.
        assertThatThrownBy(() -> insertBookingWithBlockedRange(
                staffId, "CONFIRMED", NINE_AM, 60, 10, 10,
                NINE_AM, NINE_AM.plus(60, ChronoUnit.MINUTES), null))
                .isInstanceOf(DataIntegrityViolationException.class)
                .satisfies(thrown -> assertThat(sqlStateOf(thrown)).isEqualTo(CHECK_VIOLATION));

        assertThat(activeBookingCount()).isZero();
    }

    @Test
    @DisplayName("D3: a PENDING booking with no expiry is refused, because nothing would release it")
    void rejectsAPendingBookingWithNoExpiry() {
        // PENDING holds the slot via booking_no_overlap, and the sweeper finds stale holds with
        // `expires_at < now()`. NULL < now() is NULL, so a PENDING row without an expiry is a
        // slot no job will ever release and no CONFIRMED-filtered admin list will ever show.
        assertThatThrownBy(() -> insertBookingWithBlockedRange(
                staffId, "PENDING", NINE_AM, 60, 0, 0,
                NINE_AM, NINE_AM.plus(60, ChronoUnit.MINUTES), null))
                .isInstanceOf(DataIntegrityViolationException.class)
                .satisfies(thrown -> assertThat(sqlStateOf(thrown)).isEqualTo(CHECK_VIOLATION));

        assertThat(activeBookingCount()).isZero();
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
        Instant endsAt = startsAt.plus(durationMinutes, ChronoUnit.MINUTES);
        // A PENDING row has to carry an expiry (booking_pending_expiry_chk): the hold is a
        // deposit in flight, and a hold with no deadline is a slot lost for good.
        // Derived from the appointment rather than from the wall clock. Nothing in this class reads
        // it — the constraint does not mention expires_at — so the only requirement is that the
        // column is populated, and a real now() here would be the one unpinned clock in src/test
        // for a value no assertion depends on. TestHygieneTest enforces that.
        Instant expiresAt = "PENDING".equals(status)
                ? startsAt.minus(15, ChronoUnit.MINUTES)
                : null;

        return insertBookingWithBlockedRange(staff, status, startsAt, durationMinutes,
                bufferBefore, bufferAfter,
                startsAt.minus(bufferBefore, ChronoUnit.MINUTES),
                endsAt.plus(bufferAfter, ChronoUnit.MINUTES),
                expiresAt);
    }

    /**
     * The same insert with the blocked window and the expiry supplied rather than derived, so a
     * test can store the wrong ones on purpose. Nothing that asserts on the exclusion constraint
     * should use this — those tests want a correctly computed row, which is what
     * {@link #insertBooking} guarantees.
     */
    private UUID insertBookingWithBlockedRange(UUID staff, String status, Instant startsAt,
                                               int durationMinutes, int bufferBefore,
                                               int bufferAfter, Instant blockedFrom,
                                               Instant blockedTo, Instant expiresAt) {
        UUID id = UUID.randomUUID();
        Instant endsAt = startsAt.plus(durationMinutes, ChronoUnit.MINUTES);

        jdbc.update("""
                INSERT INTO booking
                    (id, business_id, service_id, staff_id, guest_name, guest_email,
                     starts_at, ends_at, blocked_from, blocked_to, status, price_cents,
                     buffer_before_minutes, buffer_after_minutes, cancellation_token,
                     expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                id, businessId, serviceId, staff, "Alex Guest", "guest@example.test",
                utc(startsAt), utc(endsAt), utc(blockedFrom), utc(blockedTo),
                status, 5000L, bufferBefore, bufferAfter, UUID.randomUUID(),
                expiresAt == null ? null : utc(expiresAt));
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
