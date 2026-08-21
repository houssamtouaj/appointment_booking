package com.slotflow.availability;

import static com.slotflow.support.fixtures.Fixtures.aBooking;
import static com.slotflow.support.fixtures.Fixtures.aService;
import static com.slotflow.support.fixtures.Fixtures.anOverride;
import static com.slotflow.support.fixtures.Fixtures.workingHours;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.booking.BookingRepository;
import com.slotflow.business.BookingPolicy;
import com.slotflow.catalog.ServiceOffering;
import com.slotflow.catalog.ServiceOfferingRepository;
import com.slotflow.catalog.StaffService;
import com.slotflow.catalog.StaffServiceRepository;
import com.slotflow.staff.User;
import com.slotflow.support.ApiIntegrationTest;
import com.slotflow.support.QueryCounter;
import jakarta.persistence.EntityManagerFactory;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * The gate that a green suite cannot otherwise protect: how many round trips a month view costs.
 *
 * <p>Plan 09's rule is that the working hours, the overrides and the bookings are fetched once each
 * for the whole range and all candidate staff. Four more statements resolve what was asked about —
 * the business, the service, the policy, and who performs the service — so the endpoint is
 * {@value #STATEMENTS_PER_REQUEST} statements, and the number that matters is that it is the same
 * {@value #STATEMENTS_PER_REQUEST} for one day as for sixty, and the same for three staff members as
 * for one.
 *
 * <p>Both halves are asserted. The exact number catches a fourth load creeping in; the two
 * comparisons catch the failure that actually happens, which is a loop over the dates or over the
 * staff producing a response nobody can tell apart from the right one.
 */
class AvailabilityQueryCountIT extends ApiIntegrationTest {

    /**
     * business + service + policy + staff-for-service, then working hours + overrides + bookings.
     *
     * <p>Only the last three grow with what is being asked; the four lookups are a fixed cost of
     * having a slug in the path instead of a token.
     */
    private static final int STATEMENTS_PER_REQUEST = 7;

    private static final ZoneId PARIS = ZoneId.of("Europe/Paris");
    private static final LocalDate MONDAY = LocalDate.of(2026, 3, 2);

    @Autowired
    private EntityManagerFactory entityManagerFactory;

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

    private QueryCounter queries;

    @BeforeEach
    void countQueries() {
        queries = new QueryCounter(entityManagerFactory);
    }

    @Test
    @DisplayName("a 30-day, 3-staff query is seven statements, and so is a one-day one")
    void thirtyDaysCostsTheSameAsOneDay() throws Exception {
        Salon salon = aBusySalon();

        long oneDay = queries.statementsDuring(() -> perform(salon, MONDAY, MONDAY));
        long thirtyDays = queries.statementsDuring(() -> perform(salon, MONDAY, MONDAY.plusDays(29)));

        assertThat(thirtyDays)
                .describedAs("a month view must not be a loop over its days")
                .isEqualTo(oneDay)
                .isEqualTo(STATEMENTS_PER_REQUEST);
    }

    @Test
    @DisplayName("three staff members cost the same as one: the loads are keyed by the whole set")
    void threeStaffCostTheSameAsOne() throws Exception {
        Salon salon = aBusySalon();

        long anybody = queries.statementsDuring(
                () -> perform(salon, MONDAY, MONDAY.plusDays(29)));
        long justOne = queries.statementsDuring(() -> perform(
                request(salon, MONDAY, MONDAY.plusDays(29))
                        .param("staffId", salon.staff().getFirst().toString())));

        assertThat(anybody).isEqualTo(justOne).isEqualTo(STATEMENTS_PER_REQUEST);
    }

    @Test
    @DisplayName("a service nobody performs stops after four: there is nothing left to load")
    void anUnstaffedServiceSkipsTheThreeLoads() throws Exception {
        Salon salon = aBusySalon();
        ServiceOffering orphan = services.save(aService().forBusiness(salon.businessId())
                .withName("Nobody does this").build());

        long statements = queries.statementsDuring(() -> mockMvc.perform(get(path(salon))
                        .param("serviceId", orphan.getId().toString())
                        .param("from", MONDAY.toString())
                        .param("to", MONDAY.plusDays(29).toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0)));

        // Empty in, empty out, without three round trips to prove it — the same guard the
        // repositories carry for an empty staff set, one level up.
        assertThat(statements).isEqualTo(STATEMENTS_PER_REQUEST - 3);
    }

    @Test
    @DisplayName("a 30-day, 3-staff query answers in well under 200 ms")
    void aMonthViewIsFastEnoughToDemo() throws Exception {
        Salon salon = aBusySalon();
        for (int warmUp = 0; warmUp < 3; warmUp++) {
            perform(salon, MONDAY, MONDAY.plusDays(29));
        }

        // Best of five, and a ceiling four times the plan's number rather than the number itself.
        // A wall-clock assertion on a shared build agent is a flake waiting to happen unless it is
        // written to catch an order of magnitude rather than a percentage - which is the failure
        // this is for, because the way this endpoint gets slow is a loop appearing inside it, and
        // that costs thirty times the time and not thirty per cent. The query counter above is the
        // precise half of the same guard; this one is the half that would notice the algorithm
        // itself going quadratic.
        long best = Long.MAX_VALUE;
        for (int run = 0; run < 5; run++) {
            long startedAt = System.nanoTime();
            perform(salon, MONDAY, MONDAY.plusDays(29));
            best = Math.min(best, (System.nanoTime() - startedAt) / 1_000_000);
        }

        assertThat(best)
                .describedAs("a 30-day, 3-staff month view took %d ms", best)
                .isLessThan(200L);
    }

    // =================================================================================
    //  a month of real data, so the count is measured against something worth loading
    // =================================================================================

    private record Salon(Tenant tenant, UUID serviceId, List<UUID> staff) {

        UUID businessId() {
            return tenant.id();
        }

        String slug() {
            return tenant.business().getSlug();
        }
    }

    /**
     * Three staff on a weekday template, a booking a day and a scattering of overrides.
     *
     * <p>Rows the query would have to work for, so that a per-day implementation would be measurably
     * wrong rather than accidentally cheap on an empty calendar.
     */
    private Salon aBusySalon() {
        Tenant tenant = aTenant();
        BookingPolicy policy = policies.findById(tenant.id()).orElseThrow();
        policy.setMinLeadTimeHours(0);
        policies.save(policy);

        ServiceOffering haircut = services.save(aService().forBusiness(tenant.business())
                .withName("Haircut").withDuration(60).build());

        List<UUID> staff = new ArrayList<>();
        List<User> team = List.of(tenant.owner(), aStaffMemberOf(tenant), aStaffMemberOf(tenant));
        for (User member : team) {
            staff.add(member.getId());
            assignments.save(new StaffService(tenant.id(), member.getId(), haircut.getId()));
            workingHours.saveAll(workingHours().forStaff(member)
                    .from("09:00").to("17:00").buildWeekdays());
        }

        for (int day = 0; day < 30; day++) {
            LocalDate date = MONDAY.plusDays(day);
            bookings.save(aBooking().forService(haircut).withStaff(staff.getFirst())
                    .at(LocalDateTime.of(date, java.time.LocalTime.of(11, 0))
                            .atZone(PARIS).toInstant())
                    .build());
            if (day % 7 == 3) {
                overrides.save(anOverride().forBusiness(tenant.id()).forStaff(staff.get(1))
                        .on(date).wholeDay().blocked().because("Day off").build());
            }
            if (day % 11 == 0) {
                overrides.save(anOverride().forBusiness(tenant.id()).businessWide()
                        .on(date).wholeDay().blocked().because("Closed").build());
            }
        }

        return new Salon(tenant, haircut.getId(), List.copyOf(staff));
    }

    // ---------------------------------------------------------------------------------

    private static String path(Salon salon) {
        return "/api/public/businesses/" + salon.slug() + "/availability";
    }

    private static MockHttpServletRequestBuilder request(Salon salon, LocalDate from, LocalDate to) {
        return get(path(salon))
                .param("serviceId", salon.serviceId().toString())
                .param("from", from.toString())
                .param("to", to.toString());
    }

    private void perform(Salon salon, LocalDate from, LocalDate to) throws Exception {
        perform(request(salon, from, to));
    }

    private void perform(MockHttpServletRequestBuilder request) throws Exception {
        mockMvc.perform(request).andExpect(status().isOk());
    }
}
