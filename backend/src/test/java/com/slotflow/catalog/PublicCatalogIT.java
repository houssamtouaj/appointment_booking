package com.slotflow.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.availability.WorkingHoursRepository;
import com.slotflow.staff.User;
import com.slotflow.support.ApiIntegrationTest;
import com.slotflow.support.fixtures.Fixtures;
import java.time.DayOfWeek;
import java.util.Locale;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MvcResult;

/**
 * The two unauthenticated endpoints the booking page opens with: the business itself and its
 * catalog.
 *
 * <p>As with {@code PublicStaffEndpointIT}, the leak assertions are made on the <b>raw JSON</b>. A
 * test that maps the response back into a DTO cannot fail when the endpoint starts returning a
 * buffer or an email address, because the mapping silently drops whatever it does not recognise —
 * which is exactly the accident a public endpoint has to be protected from.
 */
class PublicCatalogIT extends ApiIntegrationTest {

    @Autowired
    private ServiceOfferingRepository services;

    @Autowired
    private WorkingHoursRepository workingHours;

    @Test
    @DisplayName("the business page carries the catalog, the currency and the deposit rule")
    void theBusinessPageIsOneRoundTrip() throws Exception {
        Tenant tenant = aTenant();
        services.save(Fixtures.aService().forBusiness(tenant.business())
                .withName("Cut").withDescription("Wash and cut.")
                .withPriceCents(3_000L).withDuration(30)
                // Buffers exist on the row and must not reach the wire: the customer is booking
                // thirty minutes, and the ten the calendar also loses are none of their business.
                .withBuffers(10, 10).build());
        services.save(Fixtures.aService().forBusiness(tenant.business())
                .withName("Archived").inactive().build());

        MvcResult result = mockMvc.perform(get(page(tenant)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value(tenant.business().getSlug()))
                .andExpect(jsonPath("$.name").value(tenant.business().getName()))
                .andExpect(jsonPath("$.timezone").value("Europe/Paris"))
                .andExpect(jsonPath("$.currency").value("EUR"))
                .andExpect(jsonPath("$.depositRequired").value(false))
                // The archived one is gone; the live one is here, priced and timed.
                .andExpect(jsonPath("$.services.length()").value(1))
                .andExpect(jsonPath("$.services[0].name").value("Cut"))
                .andExpect(jsonPath("$.services[0].priceCents").value(3000))
                .andExpect(jsonPath("$.services[0].durationMinutes").value(30))
                // Five members and no sixth: the count is the assertion, so a field added to the
                // public DTO fails here rather than shipping quietly.
                .andExpect(jsonPath("$.services[0].length()").value(5))
                .andReturn();

        assertThat(result.getResponse().getContentAsString())
                .doesNotContain("buffer")
                .doesNotContain("Archived")
                .doesNotContain("active")
                .doesNotContain(tenant.owner().getEmail());
    }

    @Test
    @DisplayName("a deposit percentage of zero is reported as no deposit at all")
    void aZeroPercentDepositIsNoDeposit() throws Exception {
        Tenant tenant = aTenant();
        // The database allows the flag with a zero percentage and it has no useful meaning: it would
        // send a customer to a checkout for nothing. requiresDeposit() is the answer, not the column.
        tenant.business().setDepositPolicy(true, 0);
        businesses.save(tenant.business());

        mockMvc.perform(get(page(tenant)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.depositRequired").value(false))
                .andExpect(jsonPath("$.depositPercent").value(0));

        tenant.business().setDepositPolicy(true, 30);
        businesses.save(tenant.business());
        mockMvc.perform(get(page(tenant)))
                .andExpect(jsonPath("$.depositRequired").value(true))
                .andExpect(jsonPath("$.depositPercent").value(30));
    }

    @Test
    @DisplayName("opening hours are the union of active staff hours, split shifts included (D5)")
    void openingHoursAreDerivedFromTheTeam() throws Exception {
        Tenant tenant = aTenant();
        User colleague = aStaffMemberOf(tenant);
        User leaver = aStaffMemberOf(tenant);

        // The owner works a split shift; the colleague starts earlier and finishes later than
        // either half of it, so the hull has to come from both people rather than from one row.
        workingHours.saveAll(Fixtures.workingHours().forStaff(tenant.owner())
                .from("09:00").to("12:00").buildFor(DayOfWeek.MONDAY));
        workingHours.saveAll(Fixtures.workingHours().forStaff(tenant.owner())
                .from("13:00").to("17:00").buildFor(DayOfWeek.MONDAY));
        workingHours.saveAll(Fixtures.workingHours().forStaff(colleague)
                .from("08:30").to("18:00").buildFor(DayOfWeek.MONDAY));
        // Saturday is only worked by somebody who has been deactivated, so the landing page must
        // not claim the business is open: their hours stopped being bookable at the same moment.
        workingHours.saveAll(Fixtures.workingHours().forStaff(leaver)
                .from("10:00").to("14:00").buildFor(DayOfWeek.SATURDAY));
        leaver.deactivate();
        users.save(leaver);

        mockMvc.perform(get(page(tenant)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.openingHours.length()").value(1))
                .andExpect(jsonPath("$.openingHours[0].dayOfWeek").value("MONDAY"))
                .andExpect(jsonPath("$.openingHours[0].opensAt").value("08:30:00"))
                .andExpect(jsonPath("$.openingHours[0].closesAt").value("18:00:00"))
                .andExpect(jsonPath("$.openingHours[0].closesNextDay").value(false));
    }

    @Test
    @DisplayName("a night shift closes the next day, and says so")
    void aNightShiftIsReportedHonestly() throws Exception {
        Tenant tenant = aTenant();
        workingHours.saveAll(Fixtures.workingHours().forStaff(tenant.owner())
                .overnight().buildFor(DayOfWeek.FRIDAY));

        // 22:00–02:00. Without the flag a client cannot tell a four-hour night shift from a
        // twenty-hour day that somebody typed backwards.
        mockMvc.perform(get(page(tenant)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.openingHours[0].dayOfWeek").value("FRIDAY"))
                .andExpect(jsonPath("$.openingHours[0].opensAt").value("22:00:00"))
                .andExpect(jsonPath("$.openingHours[0].closesAt").value("02:00:00"))
                .andExpect(jsonPath("$.openingHours[0].closesNextDay").value(true));
    }

    @Test
    @DisplayName("a business with no hours configured yet has an empty list, not an error")
    void noHoursIsAnEmptyList() throws Exception {
        Tenant tenant = aTenant();

        mockMvc.perform(get(page(tenant)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.openingHours.length()").value(0));
    }

    @Test
    @DisplayName("the standalone services list hides a deactivated service immediately")
    void theServicesListIsActiveOnly() throws Exception {
        Tenant tenant = aTenant();
        var archived = services.save(
                Fixtures.aService().forBusiness(tenant.business()).withName("Old").build());
        services.save(Fixtures.aService().forBusiness(tenant.business()).withName("New").build());

        mockMvc.perform(get(services(tenant)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));

        archived.deactivate();
        services.save(archived);

        mockMvc.perform(get(services(tenant)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].name").value("New"));
    }

    @Test
    @DisplayName("both endpoints work with no Authorization header, and with a stale one")
    void theEndpointsArePublic() throws Exception {
        Tenant tenant = aTenant();

        mockMvc.perform(get(page(tenant))).andExpect(status().isOk());
        mockMvc.perform(get(services(tenant))).andExpect(status().isOk());
        // A leftover header from another tab must not turn a public read into a 401.
        mockMvc.perform(get(page(tenant)).header("Authorization", "Bearer not-a-real-token"))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("the slug is matched however the customer typed it, and an unknown one is a 404")
    void theSlugIsNormalisedAtTheBoundary() throws Exception {
        Tenant tenant = aTenant();
        String shouted = tenant.business().getSlug().toUpperCase(Locale.ROOT);

        mockMvc.perform(get("/api/public/businesses/" + shouted))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value(tenant.business().getSlug()));
        mockMvc.perform(get("/api/public/businesses/" + shouted + "/services"))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/public/businesses/no-such-clinic"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
        mockMvc.perform(get("/api/public/businesses/no-such-clinic/services"))
                .andExpect(status().isNotFound());
    }

    private static String page(Tenant tenant) {
        return "/api/public/businesses/" + tenant.business().getSlug();
    }

    private static String services(Tenant tenant) {
        return page(tenant) + "/services";
    }
}
