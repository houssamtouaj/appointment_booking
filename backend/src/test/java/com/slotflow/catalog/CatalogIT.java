package com.slotflow.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.booking.Booking;
import com.slotflow.booking.BookingRepository;
import com.slotflow.staff.User;
import com.slotflow.support.ApiIntegrationTest;
import com.slotflow.support.fixtures.Fixtures;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * {@code /api/services}: the catalog round trip, the role split, and the two rules plan 07 warns
 * are easy to get wrong — what {@code staffIds} means when it is absent, and what a duration is
 * <em>not</em> validated against.
 */
class CatalogIT extends ApiIntegrationTest {

    @Autowired
    private ServiceOfferingRepository services;

    @Autowired
    private StaffServiceRepository assignments;

    @Autowired
    private BookingRepository bookings;

    // ---------------------------------------------------------------------------------
    //  the round trip
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("an owner creates, reads, edits and deactivates a service")
    void theFullRoundTrip() throws Exception {
        Tenant tenant = aTenant();
        User colleague = aStaffMemberOf(tenant);

        UUID id = UUID.fromString(json.readTree(
                mockMvc.perform(asOwner(post("/api/services"), tenant, """
                                {
                                  "name": "Deep tissue massage",
                                  "description": "Sixty minutes, firm.",
                                  "durationMinutes": 60,
                                  "priceCents": 7500,
                                  "bufferBeforeMinutes": 10,
                                  "bufferAfterMinutes": 5,
                                  "staffIds": ["%s"]
                                }
                                """.formatted(colleague.getId())))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.name").value("Deep tissue massage"))
                        // The calendar loses 75 minutes for a 60-minute appointment, and the number
                        // comes off the entity rather than being added up by the client (D4).
                        .andExpect(jsonPath("$.totalBlockMinutes").value(75))
                        .andExpect(jsonPath("$.active").value(true))
                        .andExpect(jsonPath("$.bookable").value(true))
                        .andExpect(jsonPath("$.staffIds.length()").value(1))
                        .andReturn().getResponse().getContentAsString())
                .get("id").asText());

        mockMvc.perform(asOwner(get("/api/services/" + id), tenant, null))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.priceCents").value(7500))
                .andExpect(jsonPath("$.durationMinutes").value(60));

        mockMvc.perform(asOwner(patch("/api/services/" + id), tenant, """
                        {"priceCents": 8000, "bufferAfterMinutes": 15}
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.priceCents").value(8000))
                // Buffers are one decision on the entity, so patching one keeps the other.
                .andExpect(jsonPath("$.bufferBeforeMinutes").value(10))
                .andExpect(jsonPath("$.bufferAfterMinutes").value(15))
                .andExpect(jsonPath("$.staffIds.length()").value(1));

        mockMvc.perform(asOwner(delete("/api/services/" + id), tenant, null))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false))
                // An inactive service produces no slots, whoever is assigned to it.
                .andExpect(jsonPath("$.bookable").value(false));

        // Soft: the row is still there and still readable, which is what keeps its bookings honest.
        mockMvc.perform(asOwner(get("/api/services/" + id), tenant, null))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Deep tissue massage"));
    }

    @Test
    @DisplayName("the list is paginated, tenant-scoped and filterable by active")
    void theListIsPaginatedAndFilterable() throws Exception {
        Tenant tenant = aTenant();
        Tenant elsewhere = aTenant();
        services.save(Fixtures.aService().forBusiness(tenant.business()).withName("Cut").build());
        services.save(Fixtures.aService().forBusiness(tenant.business()).withName("Blow dry")
                .inactive().build());
        services.save(Fixtures.aService().forBusiness(elsewhere.business())
                .withName("Not mine").build());

        mockMvc.perform(asOwner(get("/api/services"), tenant, null))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(20))
                .andExpect(jsonPath("$.totalPages").value(1))
                // Sorted by name, so page 2 of a real catalog cannot repeat page 1.
                .andExpect(jsonPath("$.content[0].name").value("Blow dry"))
                .andExpect(jsonPath("$.content[1].name").value("Cut"));

        mockMvc.perform(asOwner(get("/api/services?active=true"), tenant, null))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].name").value("Cut"));

        mockMvc.perform(asOwner(get("/api/services?active=false"), tenant, null))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].name").value("Blow dry"));
    }

    @Test
    @DisplayName("a page past the end reports the catalog's real totals, not zero")
    void aPagePastTheEndKeepsItsTotals() throws Exception {
        Tenant tenant = aTenant();
        services.save(Fixtures.aService().forBusiness(tenant.business()).withName("Cut").build());
        services.save(Fixtures.aService().forBusiness(tenant.business()).withName("Shave").build());

        // No rows on this page, but two in the catalog. The query ran and counted them, so the
        // envelope must say so: totalPages: 0 here tells a paginator the catalog is empty and
        // leaves it no way back to page 0.
        mockMvc.perform(asOwner(get("/api/services?page=3&size=1"), tenant, null))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0))
                .andExpect(jsonPath("$.page").value(3))
                .andExpect(jsonPath("$.size").value(1))
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.totalPages").value(2));
    }

    // ---------------------------------------------------------------------------------
    //  the role split
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("a staff token reads the catalog and cannot write to it")
    void staffMayReadAndNotWrite() throws Exception {
        Tenant tenant = aTenant();
        User colleague = aStaffMemberOf(tenant);
        UUID id = services.save(Fixtures.aService().forBusiness(tenant.business()).build()).getId();

        mockMvc.perform(get("/api/services").header(HttpHeaders.AUTHORIZATION, bearer(colleague)))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/services/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(colleague)))
                .andExpect(status().isOk());

        // Every write, not only the interesting one: a role rule that holds for two of three verbs
        // is the kind of gap nobody notices until it is used.
        mockMvc.perform(as(post("/api/services"), colleague, """
                        {"name": "Sneaky", "durationMinutes": 30, "priceCents": 100}
                        """))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
        mockMvc.perform(as(patch("/api/services/" + id), colleague, """
                        {"priceCents": 1}
                        """))
                .andExpect(status().isForbidden());
        mockMvc.perform(as(delete("/api/services/" + id), colleague, null))
                .andExpect(status().isForbidden());
    }

    // ---------------------------------------------------------------------------------
    //  validation
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("a duration off the five-minute grid names the field it came from")
    void aDurationOffTheGridIsRejected() throws Exception {
        Tenant tenant = aTenant();

        mockMvc.perform(asOwner(post("/api/services"), tenant, """
                        {"name": "Odd", "durationMinutes": 47, "priceCents": 1000}
                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("durationMinutes"))
                .andExpect(jsonPath("$.errors[0].message")
                        .value("must be a multiple of 5 minutes"));

        mockMvc.perform(asOwner(post("/api/services"), tenant, """
                        {"name": "Instant", "durationMinutes": 0, "priceCents": 1000}
                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errors[0].message").value("must be at least 5 minutes"));

        mockMvc.perform(asOwner(post("/api/services"), tenant, """
                        {"name": "All day", "durationMinutes": 600, "priceCents": 1000}
                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errors[0].message").value("must be at most 480 minutes"));
    }

    @Test
    @DisplayName("a duration is not validated against the business slot granularity")
    void aDurationIsNotValidatedAgainstTheGranularity() throws Exception {
        Tenant tenant = aTenant();
        // The tempting wrong rule plan 07 names explicitly. Granularity governs where a slot may
        // start, so a 45-minute service on a 30-minute grid is ordinary: the 09:00 slot ends at
        // 09:45 and the next start on offer is 10:00. Rejecting it would let a policy change
        // invalidate a catalog that was never wrong.
        var policy = policies.findById(tenant.id()).orElseThrow();
        policy.setSlotGranularityMinutes(30);
        policies.save(policy);

        mockMvc.perform(asOwner(post("/api/services"), tenant, """
                        {"name": "Forty five", "durationMinutes": 45, "priceCents": 4500}
                        """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.durationMinutes").value(45));
    }

    @Test
    @DisplayName("the other field rules are refused with the field named")
    void theOtherFieldRules() throws Exception {
        Tenant tenant = aTenant();

        mockMvc.perform(asOwner(post("/api/services"), tenant, """
                        {"name": "X", "durationMinutes": 30, "priceCents": 100}
                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errors[0].field").value("name"));

        mockMvc.perform(asOwner(post("/api/services"), tenant, """
                        {"name": "Free", "durationMinutes": 30, "priceCents": -1}
                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errors[0].field").value("priceCents"));

        mockMvc.perform(asOwner(post("/api/services"), tenant, """
                        {"name": "Long setup", "durationMinutes": 30, "priceCents": 100,
                         "bufferBeforeMinutes": 121}
                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errors[0].field").value("bufferBeforeMinutes"));

        // Zero is a real price: a free first consultation is a thing businesses offer.
        mockMvc.perform(asOwner(post("/api/services"), tenant, """
                        {"name": "First consultation", "durationMinutes": 15, "priceCents": 0}
                        """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.priceCents").value(0));
    }

    // ---------------------------------------------------------------------------------
    //  the assignment set
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("another tenant's staff id is 422 STAFF_NOT_IN_BUSINESS, naming the id")
    void assigningAStrangerIsRejected() throws Exception {
        Tenant tenant = aTenant();
        Tenant elsewhere = aTenant();
        User stranger = aStaffMemberOf(elsewhere);

        mockMvc.perform(asOwner(post("/api/services"), tenant, """
                        {"name": "Massage", "durationMinutes": 60, "priceCents": 5000,
                         "staffIds": ["%s"]}
                        """.formatted(stranger.getId())))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("STAFF_NOT_IN_BUSINESS"))
                // The ids that failed, so a form with one stale row can say which one.
                .andExpect(jsonPath("$.staffIds[0]").value(stranger.getId().toString()));

        // Nothing was created: the check runs before the insert, and the whole write is one
        // transaction either way.
        assertThat(services.findByBusinessIdAndActiveTrue(tenant.id())).isEmpty();
    }

    @Test
    @DisplayName("staffIds is bounded and null-free, and says so before the lookup runs")
    void staffIdsIsBoundedAndNullFree() throws Exception {
        Tenant tenant = aTenant();
        User colleague = aStaffMemberOf(tenant);

        // The mixed case is the one that used to get past validation: a lone null leaves the
        // membership set empty and reports STAFF_NOT_IN_BUSINESS, but a real id alongside it makes
        // that set non-empty, and Set.copyOf answers contains(null) with a NullPointerException.
        mockMvc.perform(asOwner(post("/api/services"), tenant, """
                        {"name": "Massage", "durationMinutes": 60, "priceCents": 5000,
                         "staffIds": ["%s", null]}
                        """.formatted(colleague.getId())))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("staffIds[1]"));

        // And the list is capped, so the ids cannot become an unbounded IN (...) parameter list.
        String tooMany = IntStream.range(0, 101)
                .mapToObj(i -> "\"" + UUID.randomUUID() + "\"")
                .collect(Collectors.joining(", "));
        mockMvc.perform(asOwner(post("/api/services"), tenant, """
                        {"name": "Massage", "durationMinutes": 60, "priceCents": 5000,
                         "staffIds": [%s]}
                        """.formatted(tooMany)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("staffIds"));

        // Neither body created anything: both are refused before the service is reached.
        assertThat(services.findByBusinessIdAndActiveTrue(tenant.id())).isEmpty();
    }

    @Test
    @DisplayName("absent staffIds leaves the assignment set alone; an empty array clears it")
    void absentAndEmptyStaffIdsAreDifferent() throws Exception {
        Tenant tenant = aTenant();
        User colleague = aStaffMemberOf(tenant);
        UUID id = services.save(Fixtures.aService().forBusiness(tenant.business()).build()).getId();
        assignments.save(new StaffService(tenant.id(), colleague.getId(), id));

        // Absent: this is what a form that only edits the price sends, and it must not silently
        // unassign the team.
        mockMvc.perform(asOwner(patch("/api/services/" + id), tenant, """
                        {"priceCents": 9900}
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.staffIds.length()").value(1))
                .andExpect(jsonPath("$.bookable").value(true));

        // Explicit null is the same intention: Jackson cannot tell it from absent in a record
        // component, and this asserts the API does not pretend otherwise.
        mockMvc.perform(asOwner(patch("/api/services/" + id), tenant, """
                        {"staffIds": null}
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.staffIds.length()").value(1));

        // Empty: unassign everyone. The service survives and says it cannot be booked.
        mockMvc.perform(asOwner(patch("/api/services/" + id), tenant, """
                        {"staffIds": []}
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.staffIds.length()").value(0))
                .andExpect(jsonPath("$.bookable").value(false));
        assertThat(assignments.findByServiceId(id)).isEmpty();
    }

    @Test
    @DisplayName("staffIds replaces the set rather than adding to it")
    void staffIdsReplacesTheSet() throws Exception {
        Tenant tenant = aTenant();
        User first = aStaffMemberOf(tenant);
        User second = aStaffMemberOf(tenant);
        UUID id = services.save(Fixtures.aService().forBusiness(tenant.business()).build()).getId();
        assignments.save(new StaffService(tenant.id(), first.getId(), id));

        mockMvc.perform(asOwner(patch("/api/services/" + id), tenant, """
                        {"staffIds": ["%s"]}
                        """.formatted(second.getId())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.staffIds.length()").value(1))
                .andExpect(jsonPath("$.staffIds[0]").value(second.getId().toString()));

        assertThat(assignments.findByServiceId(id))
                .extracting(StaffService::getStaffId)
                .containsExactly(second.getId());
    }

    @Test
    @DisplayName("a service whose only performer is deactivated is not bookable either")
    void aServiceWithOnlyInactiveStaffIsNotBookable() throws Exception {
        Tenant tenant = aTenant();
        User colleague = aStaffMemberOf(tenant);
        UUID id = services.save(Fixtures.aService().forBusiness(tenant.business()).build()).getId();
        assignments.save(new StaffService(tenant.id(), colleague.getId(), id));
        colleague.deactivate();
        users.save(colleague);

        // Assigned, and still producing exactly no availability. "Nobody assigned" and "everybody
        // assigned is switched off" look different on an admin screen and behave identically, so
        // the flag has to cover both or the warning it drives is wrong half the time.
        mockMvc.perform(asOwner(get("/api/services/" + id), tenant, null))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.staffIds.length()").value(1))
                .andExpect(jsonPath("$.bookable").value(false));
    }

    // ---------------------------------------------------------------------------------
    //  D14
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("editing a price leaves an existing booking's price alone (D14)")
    void editingAPriceLeavesExistingBookingsAlone() throws Exception {
        Tenant tenant = aTenant();
        ServiceOffering massage = services.save(Fixtures.aService()
                .forBusiness(tenant.business()).withPriceCents(5_000L).withBuffers(10, 10).build());
        Booking booking = bookings.save(Fixtures.aBooking()
                .forService(massage).withStaff(tenant.owner()).inDays(2).build());

        mockMvc.perform(asOwner(patch("/api/services/" + massage.getId()), tenant, """
                        {"priceCents": 9000, "bufferBeforeMinutes": 0, "bufferAfterMinutes": 0}
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.priceCents").value(9000));

        // One assertion for a decision that would otherwise be an argument: a booking snapshots its
        // terms, so a price rise applies to the next customer and not to the one who already agreed
        // a price — and the blocked window it holds does not shrink underneath the exclusion
        // constraint that is keeping the slot for them.
        Booking reloaded = bookings.findById(booking.getId()).orElseThrow();
        assertThat(reloaded.getPriceCents()).isEqualTo(5_000L);
        assertThat(reloaded.getBufferBeforeMinutes()).isEqualTo(10);
        assertThat(reloaded.getBlockedFrom()).isEqualTo(booking.getBlockedFrom());
    }

    @Test
    @DisplayName("a service with bookings is deactivated rather than deleted, and stays readable")
    void aServiceWithBookingsIsDeactivatedNotDeleted() throws Exception {
        Tenant tenant = aTenant();
        ServiceOffering massage = services.save(
                Fixtures.aService().forBusiness(tenant.business()).build());
        Booking booking = bookings.save(Fixtures.aBooking()
                .forService(massage).withStaff(tenant.owner()).inDays(3).build());

        mockMvc.perform(asOwner(delete("/api/services/" + massage.getId()), tenant, null))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false));

        // The row is the thing the booking points at (D15 makes the hard delete impossible), so it
        // has to survive the delete for the appointment to remain describable.
        assertThat(services.findById(massage.getId())).isPresent();
        assertThat(bookings.findById(booking.getId())).isPresent();

        // And a reactivation is one patch away, so a mis-click is not a lost service.
        mockMvc.perform(asOwner(patch("/api/services/" + massage.getId()), tenant, """
                        {"active": true}
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(true));
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    private MockHttpServletRequestBuilder asOwner(MockHttpServletRequestBuilder request,
                                                  Tenant tenant, String body) {
        return as(request, tenant.owner(), body);
    }

    private MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder request, User caller,
                                             String body) {
        request.header(HttpHeaders.AUTHORIZATION, bearer(caller));
        if (body != null) {
            request.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return request;
    }
}
