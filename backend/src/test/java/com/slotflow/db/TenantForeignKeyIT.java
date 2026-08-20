package com.slotflow.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.slotflow.support.IntegrationTest;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * "No row can name a staff member from another tenant", proved where the guarantee actually lives.
 *
 * <p>Three tables carry both a {@code business_id} and a {@code staff_id}, and all three point at
 * {@code app_user (id, business_id)} with a composite foreign key rather than at {@code app_user
 * (id)} alone. The difference is the whole point: with a plain reference, a row pairing tenant A's
 * business with tenant B's staff member satisfies every constraint and commits, and the availability
 * engine — which reads by staff id — then works on it. The composite key makes that row
 * unrepresentable instead of merely wrong, for every writer, including psql.
 *
 * <p>Raw SQL throughout, and deliberately so: routing this through JPA would prove that Hibernate
 * builds the INSERT it was told to. Nothing here may depend on application code being correct.
 *
 * <p>{@link #allowsABusinessWideClosureWithNoStaffMember()} is the paired positive. The composite
 * key must not cost D5 its business-wide closure, whose whole shape is a null {@code staff_id};
 * without that case a stricter constraint that broke the feature would pass this class unnoticed.
 */
class TenantForeignKeyIT extends IntegrationTest {

    /** SQLSTATE for foreign_key_violation. */
    private static final String FOREIGN_KEY_VIOLATION = "23503";

    private static final Instant NINE_AM = Instant.parse("2026-03-02T09:00:00Z");

    @Autowired
    private JdbcTemplate jdbc;

    private UUID myBusiness;
    private UUID myStaff;
    private UUID myService;

    /** The other tenant. Only its staff member is ever reached for. */
    private UUID theirStaff;

    @BeforeEach
    void seedTwoTenants() {
        myBusiness = insertBusiness();
        myStaff = insertStaff(myBusiness);
        myService = insertService(myBusiness);

        theirStaff = insertStaff(insertBusiness());
    }

    @Test
    @DisplayName("staff_service cannot assign another tenant's staff member to our service")
    void staffServiceRejectsAForeignStaffMember() {
        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO staff_service (business_id, staff_id, service_id)
                VALUES (?, ?, ?)
                """, myBusiness, theirStaff, myService))
                .isInstanceOf(DataIntegrityViolationException.class)
                .satisfies(thrown -> assertThat(sqlStateOf(thrown)).isEqualTo(FOREIGN_KEY_VIOLATION));

        assertThatCode(() -> jdbc.update("""
                INSERT INTO staff_service (business_id, staff_id, service_id)
                VALUES (?, ?, ?)
                """, myBusiness, myStaff, myService))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("booking cannot be taken with another tenant's staff member")
    void bookingRejectsAForeignStaffMember() {
        assertThatThrownBy(() -> insertBooking(theirStaff))
                .isInstanceOf(DataIntegrityViolationException.class)
                .satisfies(thrown -> assertThat(sqlStateOf(thrown)).isEqualTo(FOREIGN_KEY_VIOLATION));

        assertThatCode(() -> insertBooking(myStaff)).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("availability_override cannot black out another tenant's staff member")
    void overrideRejectsAForeignStaffMember() {
        // The one that matters most in practice: overrides are read by staff id with no business
        // predicate, so a row committed here would close a stranger's calendar in their own
        // business, and nothing in their tenant could have written it or would think to look.
        assertThatThrownBy(() -> insertOverride(theirStaff))
                .isInstanceOf(DataIntegrityViolationException.class)
                .satisfies(thrown -> assertThat(sqlStateOf(thrown)).isEqualTo(FOREIGN_KEY_VIOLATION));

        assertThatCode(() -> insertOverride(myStaff)).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("a business-wide closure still commits: a null staff id skips the composite key (D5)")
    void allowsABusinessWideClosureWithNoStaffMember() {
        assertThatCode(() -> insertOverride(null)).doesNotThrowAnyException();

        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM availability_override
                WHERE business_id = ? AND staff_id IS NULL
                """, Integer.class, myBusiness)).isEqualTo(1);
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    private UUID insertBusiness() {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO business (id, slug, name, timezone, currency)
                VALUES (?, ?, ?, ?, ?)
                """, id, ("biz-" + UUID.randomUUID()).substring(0, 20), "Test Clinic",
                "Europe/Paris", "EUR");
        return id;
    }

    private UUID insertStaff(UUID businessId) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO app_user (id, business_id, email, full_name, role)
                VALUES (?, ?, ?, ?, 'STAFF')
                """, id, businessId, "staff-" + id + "@example.test", "Dana Okoye");
        return id;
    }

    private UUID insertService(UUID businessId) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO service_offering
                    (id, business_id, name, duration_minutes, price_cents,
                     buffer_before_minutes, buffer_after_minutes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, id, businessId, "Consultation", 60, 5000L, 0, 0);
        return id;
    }

    /** No buffers, so the blocked window is the appointment and booking_blocked_range_chk holds. */
    private void insertBooking(UUID staffId) {
        Instant endsAt = NINE_AM.plus(60, ChronoUnit.MINUTES);
        jdbc.update("""
                INSERT INTO booking
                    (id, business_id, service_id, staff_id, guest_name, guest_email,
                     starts_at, ends_at, blocked_from, blocked_to, status, price_cents,
                     buffer_before_minutes, buffer_after_minutes, cancellation_token)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, 0, 0, ?)
                """,
                UUID.randomUUID(), myBusiness, myService, staffId, "Alex Guest",
                "guest@example.test", utc(NINE_AM), utc(endsAt), utc(NINE_AM), utc(endsAt),
                5000L, UUID.randomUUID());
    }

    /** A whole-day block; {@code null} makes it the business-wide closure of D5. */
    private void insertOverride(UUID staffId) {
        jdbc.update("""
                INSERT INTO availability_override (id, business_id, staff_id, date, type, reason)
                VALUES (?, ?, ?, ?, 'BLOCKED', ?)
                """, UUID.randomUUID(), myBusiness, staffId, LocalDate.of(2026, 12, 25),
                "Christmas Day");
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
