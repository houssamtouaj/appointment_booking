package com.slotflow.demo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.availability.AvailabilityOverride;
import com.slotflow.availability.AvailabilityOverrideRepository;
import com.slotflow.availability.WorkingHours;
import com.slotflow.availability.WorkingHoursRepository;
import com.slotflow.booking.Booking;
import com.slotflow.booking.BookingRepository;
import com.slotflow.booking.BookingStatus;
import com.slotflow.business.Business;
import com.slotflow.catalog.ServiceOffering;
import com.slotflow.catalog.ServiceOfferingRepository;
import com.slotflow.catalog.StaffServiceRepository;
import com.slotflow.staff.User;
import com.slotflow.support.TestTime;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpHeaders;

/**
 * The demo seed, which is the only piece of this codebase whose acceptance criterion is how it
 * looks to a stranger.
 *
 * <p>Most of what is asserted here would be caught by nobody: a seeder cannot fail a unit test by
 * producing a boring salon. So the tests are written against the four claims the README makes about
 * the demo — it is idempotent, its dates move with the clock, its dashboard is not empty, and its
 * calendar does not contradict its own working hours — and each of those is a claim that has gone
 * quietly wrong in a portfolio project before.
 */
class DemoSeedIT extends DemoProfileTest {

    private static final ZoneId PARIS = ZoneId.of("Europe/Paris");

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

    // ---------------------------------------------------------------------------------
    //  the tenant
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("the business has a non-UTC zone and a deposit policy, which is the point of it")
    void theBusinessProvesTheTimezoneHandling() {
        Business business = demoBusiness();

        // Not UTC. A demo at offset zero cannot show that working hours are wall-clock times
        // interpreted in the business zone (D11), because at offset zero the two are the same.
        assertThat(business.getTimezone()).isEqualTo(PARIS);
        assertThat(business.getCurrency().getCurrencyCode()).isEqualTo("EUR");
        assertThat(business.requiresDeposit()).isTrue();
        assertThat(business.getDepositPercent()).isEqualTo(20);
    }

    @Test
    @DisplayName("three staff, all able to log in, and six services on varied durations")
    void thereIsATeamAndACatalogue() {
        Business business = demoBusiness();

        List<User> team = users.findByBusinessId(business.getId());
        assertThat(team).hasSize(3).allMatch(User::canLogIn);
        assertThat(team).extracting(User::getEmail).contains(DemoBusiness.OWNER_EMAIL);
        assertThat(team).filteredOn(User::isOwner).hasSize(1);

        List<ServiceOffering> catalogue = services.findByBusinessIdAndActiveTrue(business.getId());
        assertThat(catalogue).hasSize(6);
        assertThat(catalogue).extracting(ServiceOffering::getDurationMinutes)
                .contains(20, 30, 45, 60, 90);
        // Buffers are invisible in a screenshot unless something uses them, so a seed with none is
        // a seed that quietly stops demonstrating D4.
        assertThat(catalogue).filteredOn(service -> service.totalBlockMinutes()
                > service.getDurationMinutes())
                .as("services with a non-zero buffer")
                .hasSizeGreaterThanOrEqualTo(2);
        // Every service is performable by somebody, or the booking flow dead-ends on step two.
        assertThat(catalogue).allSatisfy(service -> assertThat(
                assignments.findBookableStaffIdsForService(
                        service.getId(), business.getId()))
                .as("staff who can perform %s", service.getName())
                .isNotEmpty());
    }

    @Test
    @DisplayName("the weekly template is staggered, has a split shift and covers one Saturday")
    void theTemplateIsNotThreeIdenticalWeeks() {
        Map<UUID, List<WorkingHours>> byStaff = hoursByStaff();

        assertThat(byStaff).hasSize(3);
        // Staggered: if every staff member worked the same hours, the merged calendar and the
        // per-staff availability query would look like the same feature.
        assertThat(byStaff.values().stream().map(this::earliestStart).distinct())
                .as("distinct start times across the team")
                .hasSizeGreaterThan(1);

        assertThat(byStaff.values()).anySatisfy(hours -> assertThat(hours)
                .as("a split shift: two ranges on one weekday")
                .filteredOn(range -> range.getDayOfWeek() == java.time.DayOfWeek.WEDNESDAY)
                .hasSize(2));

        assertThat(byStaff.values().stream().flatMap(List::stream))
                .as("somebody works Saturdays")
                .anyMatch(range -> range.getDayOfWeek() == java.time.DayOfWeek.SATURDAY);
    }

    @Test
    @DisplayName("one business-wide closure, one holiday week and one extra evening")
    void everyShapeOfOverrideIsRepresented() {
        List<AvailabilityOverride> seeded = overrides.findByBusinessIdAndDateBetween(
                demoBusiness().getId(), today().minusDays(60), today().plusDays(60));

        assertThat(seeded).filteredOn(AvailabilityOverride::isBusinessWide)
                .as("D5: closed for everybody, one row")
                .hasSize(1)
                .allMatch(AvailabilityOverride::isWholeDayClosure);

        List<AvailabilityOverride> holidayWeek = seeded.stream()
                .filter(override -> !override.isBusinessWide() && override.isWholeDayClosure())
                .toList();
        assertThat(holidayWeek).as("a full week off, as seven whole-day rows").hasSize(7);
        // One person, seven distinct dates — not seven rows on one date, and not one row each for
        // seven people, both of which would satisfy a bare size check.
        assertThat(holidayWeek).extracting(AvailabilityOverride::getStaffId)
                .containsOnly(holidayWeek.get(0).getStaffId());
        assertThat(holidayWeek).extracting(AvailabilityOverride::getDate)
                .doesNotHaveDuplicates().hasSize(7);

        assertThat(seeded).filteredOn(AvailabilityOverride::isExtra)
                .as("extra hours outside the template, which only a staff-level row can express")
                .hasSize(1)
                .allMatch(override -> !override.isWholeDay());
    }

    // ---------------------------------------------------------------------------------
    //  the gate items
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("a second run adds nothing: the seeder is idempotent")
    void seedingTwiceLeavesOneSalon() {
        Business first = demoBusiness();
        long bookingsBefore = seededBookings().size();

        seeder.run(new DefaultApplicationArguments());

        // Same row, not a second one — and nothing appended to the one that was there. The slug's
        // unique index is what makes this a guarantee rather than a hope, but the existence check
        // is what keeps a restart from ever reaching it.
        assertThat(businesses.findBySlug(DemoBusiness.SLUG).orElseThrow().getId())
                .isEqualTo(first.getId());
        assertThat(users.findByBusinessId(first.getId())).hasSize(3);
        assertThat(services.findByBusinessIdAndActiveTrue(first.getId())).hasSize(6);
        assertThat(seededBookings()).hasSize((int) bookingsBefore);
    }

    @Test
    @DisplayName("every date is relative to now, so redeploying in three months still looks current")
    void nothingIsHardCoded() {
        List<Booking> seeded = seededBookings();
        Instant now = TestTime.NOW;

        assertThat(seeded).as("roughly forty bookings, or the dashboard has nothing to add up")
                .hasSizeBetween(25, 60);

        Instant earliest = seeded.stream().map(Booking::getStartsAt).min(Instant::compareTo)
                .orElseThrow();
        Instant latest = seeded.stream().map(Booking::getStartsAt).max(Instant::compareTo)
                .orElseThrow();

        // Three weeks of history and a fortnight ahead, both anchored on the injected clock. The
        // window is asserted at both ends because only one of the two failure modes is visible on a
        // screen: a seed with no past leaves the dashboard at zero, and a seed with no future leaves
        // the calendar empty.
        assertThat(earliest).isAfterOrEqualTo(now.minus(Duration.ofDays(22)))
                .isBefore(now.minus(Duration.ofDays(14)));
        assertThat(latest).isAfter(now.plus(Duration.ofDays(7)))
                .isBeforeOrEqualTo(now.plus(Duration.ofDays(15)));
    }

    @Test
    @DisplayName("no booking sits outside the working hours the same seed declares")
    void theCalendarDoesNotContradictTheTemplate() {
        Map<UUID, List<WorkingHours>> byStaff = hoursByStaff();

        // The strongest assertion in this class, and the one that would have caught a seeder that
        // "worked". A booking half outside working hours is a row the availability engine would
        // never have offered, so a demo containing one contradicts itself on the first screen a
        // reviewer opens — and nothing else in the suite would notice.
        assertThat(seededBookings()).allSatisfy(booking -> {
            LocalDateTime blockedFrom = LocalDateTime.ofInstant(booking.getBlockedFrom(), PARIS);
            LocalDateTime blockedTo = LocalDateTime.ofInstant(booking.getBlockedTo(), PARIS);
            assertThat(byStaff.get(booking.getStaffId()))
                    .as("%s blocks %s-%s on a %s", booking.getGuestName(),
                            blockedFrom.toLocalTime(), blockedTo.toLocalTime(),
                            blockedFrom.getDayOfWeek())
                    .anyMatch(shift -> shift.getDayOfWeek() == blockedFrom.getDayOfWeek()
                            && !blockedFrom.toLocalTime().isBefore(shift.getStartTime())
                            && !blockedTo.toLocalTime().isAfter(shift.getEndTime()));
        });
    }

    @Test
    @DisplayName("no booking falls on a date the same seed declares closed")
    void theCalendarDoesNotContradictTheClosures() {
        UUID businessId = demoBusiness().getId();
        List<AvailabilityOverride> closures = overrides
                .findByBusinessIdAndDateBetween(businessId, today().minusDays(60),
                        today().plusDays(60)).stream()
                .filter(AvailabilityOverride::isWholeDayClosure)
                .toList();

        assertThat(seededBookings()).allSatisfy(booking -> {
            LocalDate date = LocalDate.ofInstant(booking.getStartsAt(), PARIS);
            assertThat(closures)
                    .as("a booking on %s, which is closed", date)
                    .noneMatch(closure -> closure.getDate().equals(date)
                            && (closure.isBusinessWide()
                                    || closure.getStaffId().equals(booking.getStaffId())));
        });
    }

    @Test
    @DisplayName("the outcomes are a realistic mix, with exactly two no-shows")
    void thePastIsNotAllSuccess() {
        List<Booking> seeded = seededBookings();

        Map<BookingStatus, Long> byStatus = seeded.stream().collect(
                Collectors.groupingBy(Booking::getStatus, Collectors.counting()));

        // Every one of these is load-bearing for a figure on the dashboard: COMPLETED is the only
        // status that becomes revenue, CANCELLED is what proves the week count cannot be inflated
        // by churn, CONFIRMED is what puts anything in "upcoming", and the two no-shows are the
        // numerator of a rate that is otherwise null by design.
        assertThat(byStatus).containsOnlyKeys(BookingStatus.COMPLETED, BookingStatus.CANCELLED,
                BookingStatus.NO_SHOW, BookingStatus.CONFIRMED);
        assertThat(byStatus.get(BookingStatus.NO_SHOW)).isEqualTo(2L);
        assertThat(byStatus.get(BookingStatus.COMPLETED)).isGreaterThan(
                byStatus.get(BookingStatus.CANCELLED));

        // No PENDING rows, deliberately: a hold expires after thirty minutes, so a seeded one would
        // be cancelled by the sweeper within the hour and the demo would decay on its own.
        assertThat(byStatus).doesNotContainKey(BookingStatus.PENDING);

        // Nobody real is on any of these rows. This data is deployed, and a scheduled job that
        // mails plausible-looking third-party addresses is one edit away.
        assertThat(seeded).extracting(Booking::getGuestEmail)
                .allSatisfy(email -> assertThat(email).endsWith("@example.com"));
        // And the reminder job will not try: every future booking is stamped as already reminded.
        assertThat(seeded).filteredOn(booking -> booking.getStatus() == BookingStatus.CONFIRMED)
                .allMatch(Booking::isReminderSent);
    }

    @Test
    @DisplayName("the demo owner's dashboard is not empty, which is the whole deliverable")
    void theDashboardHasNumbersOnIt() throws Exception {
        Business business = demoBusiness();
        User owner = users.findByEmailIgnoreCase(DemoBusiness.OWNER_EMAIL).orElseThrow();

        // The default range is the current week, which is too narrow to prove anything about a
        // three-week history — so the range is the whole seeded window, which is what the demo's
        // own date picker would be set to.
        mockMvc.perform(get("/api/dashboard/stats")
                .param("from", today().minusDays(21).toString())
                .param("to", today().plusDays(14).toString())
                .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                // An empty dashboard is the single most common way a portfolio demo falls flat, so
                // these are greater-than-zero assertions rather than exact ones: the figures move
                // with the calendar, the claim that they are non-zero does not.
                .andExpect(jsonPath("$.weekBookings").value(org.hamcrest.Matchers.greaterThan(0)))
                .andExpect(jsonPath("$.revenueCents").value(org.hamcrest.Matchers.greaterThan(0)))
                .andExpect(jsonPath("$.depositsCents").value(org.hamcrest.Matchers.greaterThan(0)))
                // Not null, which is what it would be if nothing had ever been completed.
                .andExpect(jsonPath("$.noShowRate").value(org.hamcrest.Matchers.greaterThan(0.0)))
                .andExpect(jsonPath("$.upcoming").isNotEmpty());

        assertThat(business.getId()).isNotNull();
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    /**
     * Scoped to the demo tenant, because container reuse means the booking table is full of other
     * tests' rows and a count over the whole table would be meaningless.
     */
    private List<Booking> seededBookings() {
        UUID businessId = demoBusiness().getId();
        Specification<Booking> ofDemo = (root, query, builder) -> builder.equal(root.get("businessId"), businessId);
        return bookings.findAll(ofDemo);
    }

    private Map<UUID, List<WorkingHours>> hoursByStaff() {
        List<UUID> team = users.findByBusinessId(demoBusiness().getId()).stream()
                .map(User::getId).toList();
        return workingHours.findForStaff(team).stream()
                .collect(Collectors.groupingBy(WorkingHours::getStaffId));
    }

    private LocalTime earliestStart(List<WorkingHours> hours) {
        return hours.stream().map(WorkingHours::getStartTime).min(LocalTime::compareTo)
                .orElseThrow();
    }

    /** Today in the salon's zone, which is the "today" the seeder itself used. */
    private LocalDate today() {
        return LocalDate.ofInstant(clock.instant(), PARIS);
    }
}
