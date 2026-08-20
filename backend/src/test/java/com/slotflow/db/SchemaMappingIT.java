package com.slotflow.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.slotflow.availability.AvailabilityOverride;
import com.slotflow.availability.AvailabilityOverrideRepository;
import com.slotflow.availability.WorkingHours;
import com.slotflow.availability.WorkingHoursRepository;
import com.slotflow.booking.Booking;
import com.slotflow.booking.BookingRepository;
import com.slotflow.booking.BookingStatus;
import com.slotflow.booking.GuestContact;
import com.slotflow.business.BookingPolicy;
import com.slotflow.business.BookingPolicyRepository;
import com.slotflow.business.Business;
import com.slotflow.business.BusinessRepository;
import com.slotflow.catalog.ServiceOffering;
import com.slotflow.catalog.ServiceOfferingRepository;
import com.slotflow.catalog.StaffService;
import com.slotflow.catalog.StaffServiceId;
import com.slotflow.catalog.StaffServiceRepository;
import com.slotflow.security.PasswordResetToken;
import com.slotflow.security.PasswordResetTokenRepository;
import com.slotflow.security.RefreshToken;
import com.slotflow.security.RefreshTokenRepository;
import com.slotflow.staff.Role;
import com.slotflow.staff.StaffInvitation;
import com.slotflow.staff.StaffInvitationRepository;
import com.slotflow.staff.User;
import com.slotflow.staff.UserRepository;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Currency;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * The real acceptance test for plan 03.
 *
 * <p><b>The most important assertion in this class is that it starts at all.</b>
 * {@code spring.jpa.hibernate.ddl-auto} is {@code validate}, so the context only comes up if every
 * mapped table and column in {@code com.slotflow} exists in the schema Flyway built. A misspelled
 * column, a {@code long} against an {@code integer}, a {@code @MappedSuperclass} that maps an
 * {@code updated_at} the token tables do not have — all of it fails here, on startup, instead of
 * halfway through a request in plan 07.
 *
 * <p>Everything below that runs through the repositories on the way in and <b>raw SQL on the way
 * out</b>. Reading an enum back through JPA would only prove that Hibernate is self-consistent; it
 * would pass just as happily if the column held {@code 0} instead of {@code PENDING}, which is
 * precisely the failure that turns into an outage the day somebody reorders a Java enum.
 */
@SpringBootTest
@Testcontainers
class SchemaMappingIT {

    /** A Monday. Pinned so the audit assertions below can be exact rather than approximate. */
    private static final Instant NOW = Instant.parse("2026-03-02T09:00:00Z");

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private BusinessRepository businesses;
    @Autowired
    private BookingPolicyRepository policies;
    @Autowired
    private UserRepository users;
    @Autowired
    private StaffInvitationRepository invitations;
    @Autowired
    private ServiceOfferingRepository services;
    @Autowired
    private StaffServiceRepository assignments;
    @Autowired
    private WorkingHoursRepository workingHours;
    @Autowired
    private AvailabilityOverrideRepository overrides;
    @Autowired
    private BookingRepository bookings;
    @Autowired
    private RefreshTokenRepository refreshTokens;
    @Autowired
    private PasswordResetTokenRepository resetTokens;

    private Business business;
    private User owner;
    private ServiceOffering service;

    /** A fresh tenant per test, so no test can pass because of another one's rows. */
    @BeforeEach
    void seedTenant() {
        business = businesses.save(new Business(uniqueSlug(), "Dana Clinic",
                ZoneId.of("Europe/Paris"), Currency.getInstance("EUR")));
        owner = users.save(User.owner(business.getId(), uniqueEmail(), "Dana Okoye", "bcrypt-hash"));
        service = services.save(new ServiceOffering(business.getId(), "Consultation", 60, 5_000L));
    }

    @Nested
    @DisplayName("enums round-trip as their string name")
    class EnumsAsStrings {

        @Test
        @DisplayName("app_user.role")
        void roleIsStoredAsAName() {
            assertThat(rawValue("app_user", "role", owner.getId())).isEqualTo("OWNER");

            User staff = users.save(
                    User.invited(business.getId(), uniqueEmail(), "Sam Ferreira", Role.STAFF));

            assertThat(rawValue("app_user", "role", staff.getId())).isEqualTo("STAFF");
        }

        @Test
        @DisplayName("booking.status")
        void bookingStatusIsStoredAsAName() {
            Booking booking = bookings.save(confirmedBooking());

            assertThat(rawValue("booking", "status", booking.getId())).isEqualTo("CONFIRMED");
        }

        @Test
        @DisplayName("availability_override.type")
        void overrideTypeIsStoredAsAName() {
            AvailabilityOverride blocked = overrides.save(AvailabilityOverride.blockedDay(
                    business.getId(), owner.getId(), LocalDate.of(2026, 12, 25), "Closed"));
            AvailabilityOverride extra = overrides.save(AvailabilityOverride.extraHours(
                    business.getId(), owner.getId(), LocalDate.of(2026, 12, 24),
                    LocalTime.of(18, 0), LocalTime.of(20, 0), "Late night"));

            assertThat(rawValue("availability_override", "type", blocked.getId()))
                    .isEqualTo("BLOCKED");
            assertThat(rawValue("availability_override", "type", extra.getId()))
                    .isEqualTo("EXTRA");
        }

        @Test
        @DisplayName("working_hours.day_of_week uses the java.time name, not the brief's 0-6 (D16)")
        void dayOfWeekIsStoredAsAName() {
            WorkingHours hours = workingHours.save(new WorkingHours(
                    owner.getId(), DayOfWeek.WEDNESDAY, LocalTime.of(9, 0), LocalTime.of(17, 0)));

            // WEDNESDAY is also the longest name at nine characters, which is what varchar(9) was
            // sized for. If the column were ever narrowed this is the row that would fail.
            assertThat(rawValue("working_hours", "day_of_week", hours.getId()))
                    .isEqualTo("WEDNESDAY");
        }

        @Test
        @DisplayName("every enum value the schema allows survives a round trip")
        void everyStatusRoundTrips() {
            // Walking the whole enum rather than a sample: the check constraints list these names
            // literally, so a mismatch on any single one is an insert that fails in production and
            // nowhere else.
            for (BookingStatus status : BookingStatus.values()) {
                UUID id = insertBookingWithStatus(status);
                assertThat(rawValue("booking", "status", id))
                        .as("status %s", status)
                        .isEqualTo(status.name());
            }
        }
    }

    @Nested
    @DisplayName("attribute converters")
    class Converters {

        @Test
        @DisplayName("a ZoneId is stored as its IANA name, not as an offset")
        void zoneIdRoundTrips() {
            assertThat(rawValue("business", "timezone", business.getId()))
                    .isEqualTo("Europe/Paris");

            Business reloaded = businesses.findById(business.getId()).orElseThrow();
            assertThat(reloaded.getTimezone()).isEqualTo(ZoneId.of("Europe/Paris"));
        }

        @Test
        @DisplayName("a Currency is stored as its ISO 4217 code")
        void currencyRoundTrips() {
            assertThat(rawValue("business", "currency", business.getId())).isEqualTo("EUR");

            Business reloaded = businesses.findById(business.getId()).orElseThrow();
            assertThat(reloaded.getCurrency()).isEqualTo(Currency.getInstance("EUR"));
        }
    }

    @Nested
    @DisplayName("auditing reads the injected Clock")
    class Auditing {

        @Test
        @DisplayName("created_at and updated_at come from the pinned clock, not the system clock")
        void auditColumnsUseTheApplicationClock() {
            // This is the payoff of wiring the DateTimeProvider to the Clock bean: the audit
            // columns are as controllable as the rest of the domain, which is what lets plan 10
            // test a sweeper that only fires on rows older than thirty minutes.
            assertThat(business.getCreatedAt()).isEqualTo(NOW);
            assertThat(business.getUpdatedAt()).isEqualTo(NOW);
        }

        @Test
        @DisplayName("an insert-only table has created_at and no updated_at to maintain")
        void tokenTablesAreInsertOnly() {
            RefreshToken token = refreshTokens.save(new RefreshToken(
                    owner.getId(), "a".repeat(64), NOW.plus(7, ChronoUnit.DAYS)));

            assertThat(token.getCreatedAt()).isEqualTo(NOW);
            assertThat(jdbc.queryForObject(
                    "SELECT count(*) FROM information_schema.columns "
                            + "WHERE table_name = 'refresh_token' AND column_name = 'updated_at'",
                    Integer.class))
                    .as("mapping an updated_at here would have failed ddl-auto: validate on startup")
                    .isZero();
        }
    }

    @Nested
    @DisplayName("assigned ids and Persistable")
    class AssignedIds {

        @Test
        @DisplayName("saving a new row persists it rather than merging it")
        void saveUsesPersistNotMerge() {
            Business fresh = new Business(uniqueSlug(), "Second Clinic",
                    ZoneId.of("America/New_York"), Currency.getInstance("USD"));
            assertThat(fresh.isNew()).isTrue();

            Business saved = businesses.save(fresh);

            // The observable difference: persist() returns the instance it was given, merge()
            // returns a managed copy. Without Persistable, every save of a new row with an assigned
            // id would take the merge path — a wasted SELECT, and a caller holding a detached
            // object that its own changes no longer affect.
            assertThat(saved).isSameAs(fresh);
            assertThat(saved.isNew()).isFalse();
        }

        @Test
        @DisplayName("a row read back from the database does not look new")
        void loadedRowsAreNotNew() {
            Business reloaded = businesses.findById(business.getId()).orElseThrow();

            assertThat(reloaded.isNew()).isFalse();
        }

        @Test
        @DisplayName("the id exists before the row does, so an aggregate can be wired up in memory")
        void idsAreAvailableBeforeInsert() {
            Business unsaved = new Business(uniqueSlug(), "Third Clinic",
                    ZoneId.of("Europe/Lisbon"), Currency.getInstance("EUR"));

            // This is the whole reason ids are generated in Java: the policy can reference the
            // business before either row is flushed, so plan 05's registration is one method
            // rather than a sequence of saveAndFlush calls.
            BookingPolicy policy = BookingPolicy.defaultsFor(unsaved.getId());
            businesses.save(unsaved);
            policies.save(policy);

            assertThat(policies.findById(unsaved.getId())).isPresent();
        }
    }

    @Nested
    @DisplayName("the rest of the mapping")
    class Mapping {

        @Test
        @DisplayName("a booking's blocked window is wider than its appointment (D4)")
        void bookingSnapshotsItsBlockedWindow() {
            service.setBuffers(10, 15);
            services.save(service);

            Booking booking = bookings.save(confirmedBooking());

            assertThat(booking.getStartsAt()).isEqualTo(NOW.plus(2, ChronoUnit.DAYS));
            assertThat(booking.getEndsAt()).isEqualTo(booking.getStartsAt().plus(60, ChronoUnit.MINUTES));
            assertThat(booking.getBlockedFrom()).isEqualTo(booking.getStartsAt().minus(10, ChronoUnit.MINUTES));
            assertThat(booking.getBlockedTo()).isEqualTo(booking.getEndsAt().plus(15, ChronoUnit.MINUTES));
            // Snapshotted, not read through the service (D14).
            assertThat(booking.getBufferBeforeMinutes()).isEqualTo(10);
            assertThat(booking.getPriceCents()).isEqualTo(5_000L);
        }

        @Test
        @DisplayName("the version column starts at zero and moves on update")
        void optimisticLockingIsWired() {
            Booking booking = bookings.save(confirmedBooking());
            assertThat(booking.getVersion()).isZero();

            booking.recordDepositPaid(1_000L);
            Booking updated = bookings.saveAndFlush(booking);

            assertThat(updated.getVersion())
                    .as("the sweeper, the webhook and an admin PATCH can all reach this row")
                    .isEqualTo(1L);
        }

        @Test
        @DisplayName("the staff_service composite key works from both directions")
        void compositeKeyIsQueryableBothWays() {
            assignments.save(new StaffService(owner.getId(), service.getId()));

            assertThat(assignments.findByServiceId(service.getId())).hasSize(1);
            assertThat(assignments.findByStaffId(owner.getId())).hasSize(1);
            assertThat(assignments.existsByStaffIdAndServiceId(owner.getId(), service.getId()))
                    .isTrue();
            assertThat(assignments.findById(new StaffServiceId(owner.getId(), service.getId())))
                    .isPresent();
        }

        @Test
        @DisplayName("a business-wide override has a null staff id (D5)")
        void businessWideOverrideHasNoStaff() {
            AvailabilityOverride closure = overrides.save(AvailabilityOverride.businessWideClosure(
                    business.getId(), LocalDate.of(2026, 12, 25), "Closed"));

            assertThat(jdbc.queryForObject(
                    "SELECT staff_id FROM availability_override WHERE id = ?",
                    UUID.class, closure.getId())).isNull();
            assertThat(overrides.findBusinessWideByDateBetween(business.getId(),
                    LocalDate.of(2026, 12, 1), LocalDate.of(2026, 12, 31)))
                    .containsExactly(closure);
        }

        @Test
        @DisplayName("the engine's query finds active bookings by buffer-expanded overlap")
        void activeBookingQueryUsesTheBlockedWindow() {
            service.setBuffers(10, 10);
            services.save(service);
            Booking booking = bookings.save(confirmedBooking());

            // A window that touches only the buffer, not the appointment. The engine has to see
            // this booking, or it would offer a slot the exclusion constraint then rejects.
            var justTheBuffer = bookings.findActiveForStaffBetween(
                    java.util.List.of(owner.getId()),
                    booking.getStartsAt().minus(10, ChronoUnit.MINUTES),
                    booking.getStartsAt().minus(5, ChronoUnit.MINUTES));
            assertThat(justTheBuffer).containsExactly(booking);

            // Half-open at both ends: a window ending exactly where the blocked range begins does
            // not overlap it, which is the same rule tstzrange applies.
            var touchingTheEdge = bookings.findActiveForStaffBetween(
                    java.util.List.of(owner.getId()),
                    booking.getBlockedFrom().minus(1, ChronoUnit.HOURS),
                    booking.getBlockedFrom());
            assertThat(touchingTheEdge).isEmpty();

            booking.cancel();
            bookings.saveAndFlush(booking);
            assertThat(bookings.findActiveForStaffBetween(java.util.List.of(owner.getId()),
                    booking.getBlockedFrom(), booking.getBlockedTo()))
                    .as("a cancelled booking releases its slot immediately")
                    .isEmpty();
        }

        @Test
        @DisplayName("an empty staff set asks the database nothing")
        void emptyStaffSetShortCircuits() {
            assertThat(bookings.findActiveForStaffBetween(java.util.List.of(), NOW, NOW.plusSeconds(1)))
                    .isEmpty();
        }

        @Test
        @DisplayName("hashed-token tables map and query by hash")
        void tokenTablesMap() {
            String refreshHash = "b".repeat(64);
            String resetHash = "c".repeat(64);
            String inviteHash = "d".repeat(64);

            refreshTokens.save(new RefreshToken(owner.getId(), refreshHash, NOW.plus(7, ChronoUnit.DAYS)));
            resetTokens.save(new PasswordResetToken(owner.getId(), resetHash, NOW.plus(1, ChronoUnit.HOURS)));
            invitations.save(new StaffInvitation(business.getId(), owner.getId(), owner.getEmail(),
                    inviteHash, NOW.plus(7, ChronoUnit.DAYS)));

            assertThat(refreshTokens.findByTokenHash(refreshHash)).isPresent();
            assertThat(resetTokens.findByTokenHash(resetHash)).isPresent();
            assertThat(invitations.findByTokenHash(inviteHash)).isPresent();
        }

        @Test
        @DisplayName("the policy's primary key is its business id, so there can only ever be one")
        void policySharesTheBusinessPrimaryKey() {
            BookingPolicy policy = policies.save(BookingPolicy.defaultsFor(business.getId()));

            assertThat(policy.getId()).isEqualTo(business.getId());
            assertThat(jdbc.queryForObject(
                    "SELECT count(*) FROM booking_policy WHERE business_id = ?",
                    Integer.class, business.getId())).isEqualTo(1);
        }
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    /**
     * Pins the clock for the whole context. Overriding the bean rather than mocking a call site
     * means the auditing provider, and every service written from plan 05 onwards, all see the
     * same fixed instant.
     */
    @TestConfiguration
    static class FixedClockConfig {

        @Bean
        @Primary
        Clock fixedClock() {
            return Clock.fixed(NOW, ZoneOffset.UTC);
        }
    }

    private Booking confirmedBooking() {
        return Booking.confirmed(business.getId(), service, owner.getId(),
                NOW.plus(2, ChronoUnit.DAYS),
                new GuestContact("Alex Guest", "alex@example.test", "+33123456789"), null);
    }

    /**
     * {@code CONFIRMED} and {@code PENDING} are the only statuses a booking can be created in
     * (D2), so the terminal ones are reached by walking the machine — which is also the only way
     * a real row ever gets there.
     */
    private UUID insertBookingWithStatus(BookingStatus status) {
        Booking booking = switch (status) {
            case PENDING -> Booking.awaitingDeposit(business.getId(), service, owner.getId(),
                    uniqueStart(), guest(), null, NOW.plus(30, ChronoUnit.MINUTES));
            case CONFIRMED -> newConfirmed();
            case CANCELLED -> {
                Booking cancelled = newConfirmed();
                cancelled.cancel();
                yield cancelled;
            }
            case COMPLETED -> {
                Booking completed = newConfirmed();
                completed.complete(completed.getEndsAt());
                yield completed;
            }
            case NO_SHOW -> {
                Booking noShow = newConfirmed();
                noShow.markNoShow(noShow.getStartsAt());
                yield noShow;
            }
        };
        return bookings.saveAndFlush(booking).getId();
    }

    private Booking newConfirmed() {
        return Booking.confirmed(business.getId(), service, owner.getId(), uniqueStart(),
                guest(), null);
    }

    /**
     * Each booking gets its own hour. The exclusion constraint is real and applies to this test
     * too — which is worth saying out loud, because a test that fought it by disabling it would
     * be testing a schema nobody deploys.
     */
    private Instant uniqueStart() {
        return NOW.plus(startOffsetHours++, ChronoUnit.HOURS);
    }

    private int startOffsetHours = 24;

    private static GuestContact guest() {
        return new GuestContact("Alex Guest", "alex@example.test", null);
    }

    private String rawValue(String table, String column, UUID id) {
        return jdbc.queryForObject(
                "SELECT %s FROM %s WHERE id = ?".formatted(column, table), String.class, id);
    }

    /** Slugs are constrained to lowercase and URL-safe; a uuid fragment satisfies both. */
    private static String uniqueSlug() {
        return ("biz-" + UUID.randomUUID()).substring(0, 20);
    }

    /** Emails are globally unique (D13), so every test needs its own. */
    private static String uniqueEmail() {
        return "user-" + UUID.randomUUID() + "@example.test";
    }
}
