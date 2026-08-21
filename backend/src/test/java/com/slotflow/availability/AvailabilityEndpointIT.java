package com.slotflow.availability;

import static com.slotflow.support.fixtures.Fixtures.aBooking;
import static com.slotflow.support.fixtures.Fixtures.aService;
import static com.slotflow.support.fixtures.Fixtures.anOverride;
import static com.slotflow.support.fixtures.Fixtures.workingHours;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.core.type.TypeReference;
import com.slotflow.booking.BookingRepository;
import com.slotflow.business.BookingPolicy;
import com.slotflow.catalog.ServiceOffering;
import com.slotflow.catalog.ServiceOfferingRepository;
import com.slotflow.catalog.StaffService;
import com.slotflow.catalog.StaffServiceRepository;
import com.slotflow.staff.User;
import com.slotflow.support.ApiIntegrationTest;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * The engine through the endpoint the booking page actually calls.
 *
 * <p>{@code AvailabilityEngineTest} owns the algorithm and covers the cases that would be absurd to
 * set up against a database — a spring-forward Sunday, a booking two months out. What is left for
 * this class is everything that only exists once the engine is wired to real rows: that the loader
 * hands it the right ones, that the four refusals are the right shapes, and that the endpoint is
 * anonymous. The exit demo is the first three tests.
 *
 * <p>Wednesday is the day under test throughout, not Monday. {@code TestTime.NOW} is Monday 09:00
 * UTC — ten in the morning in Paris — so half of Monday is already in the past, and a fixture whose
 * expected slot list changes depending on what the lead time happens to be is a fixture that teaches
 * nothing.
 */
class AvailabilityEndpointIT extends ApiIntegrationTest {

    private static final ZoneId PARIS = ZoneId.of("Europe/Paris");
    private static final LocalDate WEDNESDAY = LocalDate.of(2026, 3, 4);

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
    //  the exit demo
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("a 09:00-17:00 Wednesday offers 15 hourly-grid slots, and needs no token to read")
    void realSlotsForARealBusiness() throws Exception {
        Salon salon = aSalon();

        availability(salon, WEDNESDAY, WEDNESDAY)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(15))
                // UTC on the wire, always: Paris is on CET in early March, so 09:00 local is 08:00Z.
                .andExpect(jsonPath("$[0].start").value("2026-03-04T08:00:00Z"))
                .andExpect(jsonPath("$[0].end").value("2026-03-04T09:00:00Z"))
                .andExpect(jsonPath("$[14].start").value("2026-03-04T15:00:00Z"))
                // Both staff can serve every start: they work the same hours and neither is booked.
                .andExpect(jsonPath("$[0].staffIds.length()").value(2));
    }

    @Test
    @DisplayName("blocking the day empties it, and an EXTRA evening puts slots back outside the template")
    void blockingADayAndAddingAnEvening() throws Exception {
        Salon salon = aSalon();
        assertThat(startsOn(salon, WEDNESDAY)).hasSize(15);

        for (UUID staff : List.of(salon.dana(), salon.sam())) {
            overrides.save(anOverride().forBusiness(salon.businessId()).forStaff(staff)
                    .on(WEDNESDAY).between("09:00", "17:00").blocked().because("Offsite").build());
        }
        assertThat(startsOn(salon, WEDNESDAY)).isEmpty();

        overrides.save(anOverride().forBusiness(salon.businessId()).forStaff(salon.dana())
                .on(WEDNESDAY).between("18:00", "21:00").extra().because("Late opening").build());

        // The template is blocked, so these five are the EXTRA window and nothing else: 18:00 to
        // 21:00 on a half-hour grid, the last one ending exactly at closing.
        assertThat(startsOn(salon, WEDNESDAY)).containsExactly(
                parisTime("2026-03-04T18:00"), parisTime("2026-03-04T18:30"),
                parisTime("2026-03-04T19:00"), parisTime("2026-03-04T19:30"),
                parisTime("2026-03-04T20:00"));

        // Precedence at one level, not only across them: a day off written after the extra hours
        // takes them away again, and would have done so had it been written before.
        overrides.save(anOverride().forBusiness(salon.businessId()).forStaff(salon.dana())
                .on(WEDNESDAY).wholeDay().blocked().because("Annual leave").build());
        assertThat(startsOn(salon, WEDNESDAY)).isEmpty();
    }

    @Test
    @DisplayName("a staff EXTRA inside a business-wide closure yields nothing: BLOCKED wins (D5)")
    void staffExtraCannotReopenABusinessWideClosure() throws Exception {
        Salon salon = aSalon();

        overrides.save(anOverride().forBusiness(salon.businessId()).businessWide()
                .on(WEDNESDAY).wholeDay().blocked().because("Public holiday").build());
        overrides.save(anOverride().forBusiness(salon.businessId()).forStaff(salon.dana())
                .on(WEDNESDAY).between("18:00", "21:00").extra().because("I do not mind").build());

        assertThat(startsOn(salon, WEDNESDAY)).isEmpty();
        // And the closure applies to everybody without being fanned out into a row per person.
        assertThat(startsFor(salon, salon.sam(), WEDNESDAY)).isEmpty();
    }

    // ---------------------------------------------------------------------------------
    //  the loader hands the engine the right rows
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("a booking removes the slots its buffers cover, not only the ones it fills")
    void aBookingRemovesItsBufferedSlots() throws Exception {
        Salon salon = aSalonWithBuffers(15, 15);

        bookings.save(aBooking().forService(salon.service()).withStaff(salon.dana())
                .at(parisTime("2026-03-04T12:00")).build());
        bookings.save(aBooking().forService(salon.service()).withStaff(salon.sam())
                .at(parisTime("2026-03-04T12:00")).build());

        // The appointment costs the calendar 11:45-13:15, and every start whose own buffers would
        // reach into that is gone with it. Note where the afternoon restarts: the grid is anchored
        // at each window's own start, so once 13:15 is the edge of the day the offers run 13:45,
        // 14:15, ... rather than resuming the morning's :00 and :30.
        assertThat(startsOn(salon, WEDNESDAY)).containsExactly(
                parisTime("2026-03-04T09:30"), parisTime("2026-03-04T10:00"),
                parisTime("2026-03-04T10:30"),
                parisTime("2026-03-04T13:45"), parisTime("2026-03-04T14:15"),
                parisTime("2026-03-04T14:45"), parisTime("2026-03-04T15:15"),
                parisTime("2026-03-04T15:45"));
    }

    @Test
    @DisplayName("staffId narrows to one person; omitting it unions both and dedupes by start")
    void namedStaffNarrowsTheAnswer() throws Exception {
        Salon salon = aSalon();
        // Sam works late on Wednesday; Dana does not.
        overrides.save(anOverride().forBusiness(salon.businessId()).forStaff(salon.sam())
                .on(WEDNESDAY).between("17:00", "19:00").extra().because("Late shift").build());

        List<Instant> anybody = startsOn(salon, WEDNESDAY);
        List<Instant> justDana = startsFor(salon, salon.dana(), WEDNESDAY);

        assertThat(anybody).contains(parisTime("2026-03-04T17:00"));
        assertThat(justDana).doesNotContain(parisTime("2026-03-04T17:00")).hasSize(15);
        assertThat(anybody).doesNotHaveDuplicates();
    }

    @Test
    @DisplayName("a slot names every staff member who could serve it, so booking can pick")
    void slotsCarryTheirCandidates() throws Exception {
        Salon salon = aSalon();
        overrides.save(anOverride().forBusiness(salon.businessId()).forStaff(salon.sam())
                .on(WEDNESDAY).wholeDay().blocked().because("Annual leave").build());

        availability(salon, WEDNESDAY, WEDNESDAY)
                .andExpect(jsonPath("$[0].staffIds.length()").value(1))
                .andExpect(jsonPath("$[0].staffIds[0]").value(salon.dana().toString()));
    }

    @Test
    @DisplayName("tz moves the day boundaries and leaves the working hours in the business zone")
    void customerZoneMovesOnlyTheDayBoundaries() throws Exception {
        Salon salon = aSalon();

        // Tokyo is nine hours ahead, so its Wednesday runs from 16:00 Tuesday to 16:00 Wednesday in
        // Paris. The answer is that window: the tail of the salon's Tuesday, then its Wednesday up
        // to the boundary. The salon still opens at 09:00 Paris, not at 09:00 Tokyo.
        List<Instant> tokyo = startsIn(salon, WEDNESDAY, WEDNESDAY, "Asia/Tokyo");

        assertThat(tokyo).startsWith(parisTime("2026-03-03T16:00"))
                .endsWith(parisTime("2026-03-04T15:30"))
                .hasSize(15);
    }

    @Test
    @DisplayName("a deactivated staff member disappears from the answer without unassigning them")
    void deactivatedStaffAreNotOffered() throws Exception {
        Salon salon = aSalon();
        User sam = users.findById(salon.sam()).orElseThrow();
        sam.deactivate();
        users.save(sam);

        availability(salon, WEDNESDAY, WEDNESDAY)
                .andExpect(jsonPath("$.length()").value(15))
                .andExpect(jsonPath("$[0].staffIds.length()").value(1))
                .andExpect(jsonPath("$[0].staffIds[0]").value(salon.dana().toString()));
        // The assignment is untouched, so reactivating them restores their calendar (plan 06).
        assertThat(assignments.existsByStaffIdAndServiceId(salon.sam(), salon.serviceId())).isTrue();
    }

    @Test
    @DisplayName("a service nobody is assigned to is an empty list, not an error")
    void aServiceWithNoStaffIsEmpty() throws Exception {
        Salon salon = aSalon();
        ServiceOffering orphan = services.save(aService().forBusiness(salon.businessId())
                .withName("Nobody does this").build());

        mockMvc.perform(get(path(salon))
                        .param("serviceId", orphan.getId().toString())
                        .param("from", WEDNESDAY.toString())
                        .param("to", WEDNESDAY.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    // ---------------------------------------------------------------------------------
    //  refusals
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("an unknown slug and an unknown service are both 404")
    void unknownTenantOrService() throws Exception {
        Salon salon = aSalon();

        mockMvc.perform(get("/api/public/businesses/{slug}/availability", "no-such-shop")
                        .param("serviceId", salon.serviceId().toString())
                        .param("from", WEDNESDAY.toString())
                        .param("to", WEDNESDAY.toString()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));

        mockMvc.perform(get(path(salon))
                        .param("serviceId", UUID.randomUUID().toString())
                        .param("from", WEDNESDAY.toString())
                        .param("to", WEDNESDAY.toString()))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("a deactivated service is 422 SERVICE_INACTIVE, not an empty list")
    void inactiveServiceIsRefused() throws Exception {
        Salon salon = aSalon();
        ServiceOffering service = services.findById(salon.serviceId()).orElseThrow();
        service.deactivate();
        services.save(service);

        availability(salon, WEDNESDAY, WEDNESDAY)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SERVICE_INACTIVE"));
    }

    @Test
    @DisplayName("asking for a staff member who does not perform the service is 422")
    void unassignedStaffIsRefused() throws Exception {
        Salon salon = aSalon();
        User stranger = aStaffMemberOf(salon.tenant());

        mockMvc.perform(get(path(salon))
                        .param("serviceId", salon.serviceId().toString())
                        .param("from", WEDNESDAY.toString())
                        .param("to", WEDNESDAY.toString())
                        .param("staffId", stranger.getId().toString()))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("STAFF_NOT_ASSIGNED"));
    }

    @Test
    @DisplayName("a backwards range and an oversized one are 422s naming to")
    void badRangesAreRefused() throws Exception {
        Salon salon = aSalon();

        availability(salon, WEDNESDAY, WEDNESDAY.minusDays(1))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("to"))
                .andExpect(jsonPath("$.errors[0].message").value("must not be before from"));

        availability(salon, WEDNESDAY, WEDNESDAY.plusDays(62))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errors[0].field").value("to"))
                .andExpect(jsonPath("$.errors[0].message")
                        .value("the range must not exceed 62 days"));

        // The widest range that is still allowed, so the cap is a boundary and not a vague limit.
        availability(salon, WEDNESDAY, WEDNESDAY.plusDays(61)).andExpect(status().isOk());
    }

    @Test
    @DisplayName("an unknown zone is a 422 naming tz, and a missing serviceId is a 400")
    void badParameters() throws Exception {
        Salon salon = aSalon();

        mockMvc.perform(get(path(salon))
                        .param("serviceId", salon.serviceId().toString())
                        .param("from", WEDNESDAY.toString())
                        .param("to", WEDNESDAY.toString())
                        .param("tz", "Europe/Atlantis"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errors[0].field").value("tz"));

        mockMvc.perform(get(path(salon))
                        .param("from", WEDNESDAY.toString())
                        .param("to", WEDNESDAY.toString()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("MISSING_PARAMETER"));
    }

    // =================================================================================
    //  fixtures
    // =================================================================================

    /** The wave-4 business: two staff on the same weekday template, one bookable service. */
    private record Salon(Tenant tenant, ServiceOffering service, UUID dana, UUID sam) {

        UUID businessId() {
            return tenant.id();
        }

        String slug() {
            return tenant.business().getSlug();
        }

        UUID serviceId() {
            return service.getId();
        }
    }

    private Salon aSalon() {
        return aSalonWithBuffers(0, 0);
    }

    private Salon aSalonWithBuffers(int before, int after) {
        Tenant tenant = aTenant();
        // The default policy has a two-hour lead time and a fifteen-minute grid. A half-hour grid
        // makes the expected lists readable, and the lead time is the subject of its own unit test
        // rather than a hidden term in every assertion here.
        BookingPolicy policy = policies.findById(tenant.id()).orElseThrow();
        policy.setMinLeadTimeHours(0);
        policy.setSlotGranularityMinutes(30);
        policies.save(policy);

        ServiceOffering haircut = services.save(aService().forBusiness(tenant.business())
                .withName("Haircut").withDuration(60).withBuffers(before, after).build());

        User sam = aStaffMemberOf(tenant);
        for (User staff : List.of(tenant.owner(), sam)) {
            assignments.save(new StaffService(tenant.id(), staff.getId(), haircut.getId()));
            workingHours.saveAll(workingHours().forStaff(staff)
                    .from("09:00").to("17:00").buildWeekdays());
        }

        return new Salon(tenant, haircut, tenant.owner().getId(), sam.getId());
    }

    // ---------------------------------------------------------------------------------
    //  requests
    // ---------------------------------------------------------------------------------

    private static String path(Salon salon) {
        return "/api/public/businesses/" + salon.slug() + "/availability";
    }

    private ResultActions availability(Salon salon, LocalDate from, LocalDate to) throws Exception {
        return mockMvc.perform(request(salon, from, to));
    }

    private static MockHttpServletRequestBuilder request(Salon salon, LocalDate from, LocalDate to) {
        return get(path(salon))
                .param("serviceId", salon.serviceId().toString())
                .param("from", from.toString())
                .param("to", to.toString());
    }

    private List<Instant> startsOn(Salon salon, LocalDate date) throws Exception {
        return starts(request(salon, date, date));
    }

    private List<Instant> startsFor(Salon salon, UUID staffId, LocalDate date) throws Exception {
        return starts(request(salon, date, date).param("staffId", staffId.toString()));
    }

    private List<Instant> startsIn(Salon salon, LocalDate from, LocalDate to, String tz)
            throws Exception {
        return starts(request(salon, from, to).param("tz", tz));
    }

    private List<Instant> starts(MockHttpServletRequestBuilder request) throws Exception {
        String body = mockMvc.perform(request)
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return json.readValue(body, new TypeReference<List<SlotResponse>>() {
        }).stream().map(SlotResponse::start).toList();
    }

    private static Instant parisTime(String localDateTime) {
        return LocalDateTime.parse(localDateTime).atZone(PARIS).toInstant();
    }
}
