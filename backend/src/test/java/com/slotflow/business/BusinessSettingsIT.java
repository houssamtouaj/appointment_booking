package com.slotflow.business;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.booking.BookingRepository;
import com.slotflow.catalog.ServiceOffering;
import com.slotflow.catalog.ServiceOfferingRepository;
import com.slotflow.staff.User;
import com.slotflow.support.ApiIntegrationTest;
import com.slotflow.support.fixtures.Fixtures;
import com.jayway.jsonpath.JsonPath;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * {@code /api/business} and {@code /api/policy}: the two settings resources, and the one setting that
 * refuses to change quietly.
 *
 * <p>Neither path carries an id, so there is no cross-tenant case to write — the business under edit
 * is the one in the token. What is left to assert is the role split, the two fields bean validation
 * cannot check, and the timezone confirmation.
 */
class BusinessSettingsIT extends ApiIntegrationTest {

    @Autowired
    private BookingRepository bookings;

    @Autowired
    private ServiceOfferingRepository services;

    // ---------------------------------------------------------------------------------
    //  the business
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("an owner edits the name, currency and deposit rule; the slug is not editable")
    void theSettingsRoundTrip() throws Exception {
        Tenant tenant = aTenant();

        mockMvc.perform(asOwner(get("/api/business"), tenant, null))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value(tenant.business().getSlug()))
                .andExpect(jsonPath("$.timezone").value("Europe/Paris"))
                .andExpect(jsonPath("$.currency").value("EUR"))
                .andExpect(jsonPath("$.depositRequired").value(false))
                .andExpect(jsonPath("$.depositPercent").value(0));

        mockMvc.perform(asOwner(put("/api/business"), tenant, """
                        {"name": "Dana Clinic & Spa", "timezone": "Europe/Paris",
                         "currency": "eur", "depositRequired": true, "depositPercent": 30}
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Dana Clinic & Spa"))
                // Lower case in, ISO out: "eur" is a typo to correct, not a request to refuse.
                .andExpect(jsonPath("$.currency").value("EUR"))
                .andExpect(jsonPath("$.depositRequired").value(true))
                .andExpect(jsonPath("$.depositPercent").value(30))
                // Unchanged, and there is no field for it in the request: a booking page whose
                // address changes breaks every link the business has ever sent a customer.
                .andExpect(jsonPath("$.slug").value(tenant.business().getSlug()));

        // The admin view reports what it stored, unlike the public page, which reports the effective
        // answer. Two records, disagreeing on purpose.
        mockMvc.perform(asOwner(put("/api/business"), tenant, """
                        {"name": "Dana Clinic", "timezone": "Europe/Paris", "currency": "EUR",
                         "depositRequired": true, "depositPercent": 0}
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.depositRequired").value(true))
                .andExpect(jsonPath("$.depositPercent").value(0));
    }

    @Test
    @DisplayName("an unknown zone and a fixed offset are both refused, naming the field")
    void theTimezoneMustBeARegionId() throws Exception {
        Tenant tenant = aTenant();

        mockMvc.perform(asOwner(put("/api/business"), tenant, settings("Europe/Atlantis")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("timezone"));

        // ZoneId.of("+02:00") parses happily and carries no DST rules, which is the one thing a
        // business day needs: on a fixed offset a salon that opens at 09:00 opens at 08:00 all
        // summer. The same rule registration applies, through the same helper.
        mockMvc.perform(asOwner(put("/api/business"), tenant, settings("+02:00")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errors[0].field").value("timezone"));

        mockMvc.perform(asOwner(put("/api/business"), tenant, """
                        {"name": "Dana Clinic", "timezone": "Europe/Paris", "currency": "XYZ",
                         "depositRequired": false, "depositPercent": 0}
                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errors[0].field").value("currency"));
    }

    @Test
    @DisplayName("a deposit percentage outside 0-100 is refused by the binder")
    void theDepositPercentageIsBounded() throws Exception {
        Tenant tenant = aTenant();

        mockMvc.perform(asOwner(put("/api/business"), tenant, """
                        {"name": "Dana Clinic", "timezone": "Europe/Paris", "currency": "EUR",
                         "depositRequired": true, "depositPercent": 150}
                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errors[0].field").value("depositPercent"));
    }

    @Test
    @DisplayName("only an owner may change the settings; staff may read them")
    void writesAreOwnerOnly() throws Exception {
        Tenant tenant = aTenant();
        User colleague = aStaffMemberOf(tenant);

        // A staff member's own calendar is drawn in this timezone and their bookings are governed by
        // the policy's cutoff, so hiding the numbers would leave them unable to explain their screen.
        mockMvc.perform(as(get("/api/business"), colleague, null))
                .andExpect(status().isOk());
        mockMvc.perform(as(get("/api/policy"), colleague, null))
                .andExpect(status().isOk());

        mockMvc.perform(as(put("/api/business"), colleague, settings("Europe/Paris")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
        mockMvc.perform(as(put("/api/policy"), colleague, """
                        {"minLeadTimeHours": 0, "maxAdvanceDays": 30,
                         "cancellationCutoffHours": 0, "slotGranularityMinutes": 15}
                        """))
                .andExpect(status().isForbidden());
    }

    // ---------------------------------------------------------------------------------
    //  the timezone shift
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("moving the timezone without confirmShift is 409, with the affected count")
    void aTimezoneMoveNeedsConfirming() throws Exception {
        Tenant tenant = aTenant();
        ServiceOffering massage = services.save(
                Fixtures.aService().forBusiness(tenant.business()).build());
        bookings.save(Fixtures.aBooking()
                .forService(massage).withStaff(tenant.owner()).inDays(2).build());
        bookings.save(Fixtures.aBooking()
                .forService(massage).withStaff(tenant.owner()).inDays(5).build());

        mockMvc.perform(asOwner(put("/api/business"), tenant, settings("America/New_York")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("TIMEZONE_SHIFT_UNCONFIRMED"))
                .andExpect(jsonPath("$.currentTimezone").value("Europe/Paris"))
                .andExpect(jsonPath("$.requestedTimezone").value("America/New_York"))
                // The number is the point of the 409: the decision is made by somebody who has seen
                // how many appointments are about to move under their customers.
                .andExpect(jsonPath("$.affectedBookings").value(2));

        // Nothing changed, including the fields that were valid.
        assertThat(businesses.findById(tenant.id()).orElseThrow().getTimezone())
                .isEqualTo(ZoneId.of("Europe/Paris"));

        mockMvc.perform(asOwner(put("/api/business"), tenant, """
                        {"name": "Dana Clinic", "timezone": "America/New_York", "currency": "EUR",
                         "depositRequired": false, "depositPercent": 0, "confirmShift": true}
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.timezone").value("America/New_York"));
    }

    @Test
    @DisplayName("the confirmation is required even with an empty calendar")
    void theConfirmationIsNotConditionalOnBookings() throws Exception {
        Tenant tenant = aTenant();

        // The bookings are the visible consequence, not the reason: a business with no appointments
        // and a full week of working hours is still about to change what "we open at nine" means.
        // An endpoint that only asks when it happens to have something to warn about is one whose
        // behaviour nobody can predict.
        mockMvc.perform(asOwner(put("/api/business"), tenant, settings("Europe/Lisbon")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("TIMEZONE_SHIFT_UNCONFIRMED"))
                .andExpect(jsonPath("$.affectedBookings").value(0));
    }

    @Test
    @DisplayName("confirmShift is ignored when the timezone is unchanged")
    void everyOtherEditNeedsNoConfirmation() throws Exception {
        Tenant tenant = aTenant();

        mockMvc.perform(asOwner(put("/api/business"), tenant, """
                        {"name": "Renamed", "timezone": "Europe/Paris", "currency": "USD",
                         "depositRequired": true, "depositPercent": 50}
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Renamed"))
                .andExpect(jsonPath("$.currency").value("USD"));
    }

    // ---------------------------------------------------------------------------------
    //  the policy
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("the policy round-trips, and a 7-minute grid is refused")
    void thePolicyRoundTrip() throws Exception {
        Tenant tenant = aTenant();

        mockMvc.perform(asOwner(get("/api/policy"), tenant, null))
                .andExpect(status().isOk())
                // The schema's own defaults, created alongside the business at registration.
                .andExpect(jsonPath("$.minLeadTimeHours").value(2))
                .andExpect(jsonPath("$.maxAdvanceDays").value(60))
                .andExpect(jsonPath("$.cancellationCutoffHours").value(24))
                .andExpect(jsonPath("$.slotGranularityMinutes").value(15))
                .andExpect(jsonPath("$.updatedAt").exists());

        mockMvc.perform(asOwner(put("/api/policy"), tenant, """
                        {"minLeadTimeHours": 0, "maxAdvanceDays": 90,
                         "cancellationCutoffHours": 48, "slotGranularityMinutes": 30}
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.minLeadTimeHours").value(0))
                .andExpect(jsonPath("$.maxAdvanceDays").value(90))
                .andExpect(jsonPath("$.cancellationCutoffHours").value(48))
                .andExpect(jsonPath("$.slotGranularityMinutes").value(30));

        // A granularity of 7 is legal arithmetic and a baffling product: 09:00, 09:07, 09:14. The
        // database allows 1-480 because a check constraint is a floor, not a product decision.
        mockMvc.perform(asOwner(put("/api/policy"), tenant, """
                        {"minLeadTimeHours": 2, "maxAdvanceDays": 60,
                         "cancellationCutoffHours": 24, "slotGranularityMinutes": 7}
                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("slotGranularityMinutes"))
                .andExpect(jsonPath("$.errors[0].message")
                        .value("must be one of 5, 10, 15, 20, 30 or 60 minutes"));

        // And the four are read together, so a partial body is not a patch — it is a missing field.
        mockMvc.perform(asOwner(put("/api/policy"), tenant, """
                        {"minLeadTimeHours": 2}
                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errors.length()").value(3));
    }

    @Test
    @DisplayName("the PUT response carries the updatedAt of the write it just performed")
    void thePolicyReportsItsOwnWriteTime() throws Exception {
        Tenant tenant = aTenant();
        String before = updatedAt(mockMvc.perform(asOwner(get("/api/policy"), tenant, null))
                .andExpect(status().isOk()));

        clock.advanceBy(Duration.ofHours(3));
        String written = updatedAt(mockMvc.perform(asOwner(put("/api/policy"), tenant, """
                        {"minLeadTimeHours": 4, "maxAdvanceDays": 30,
                         "cancellationCutoffHours": 12, "slotGranularityMinutes": 20}
                        """))
                .andExpect(status().isOk()));

        // Auditing stamps @LastModifiedDate on @PreUpdate, which runs at flush — after a plain
        // save() of an already-managed entity has returned. A response built before that flush
        // carries the previous timestamp, so a client caching it to detect policy drift would see
        // a time older than the change it just made.
        String reread = updatedAt(mockMvc.perform(asOwner(get("/api/policy"), tenant, null))
                .andExpect(status().isOk()));
        assertThat(Instant.parse(written))
                .isEqualTo(Instant.parse(reread))
                .isAfter(Instant.parse(before));
    }

    @Test
    @DisplayName("the policy bounds are narrower than the schema's, and named on rejection")
    void thePolicyBoundsAreEnforced() throws Exception {
        Tenant tenant = aTenant();

        mockMvc.perform(asOwner(put("/api/policy"), tenant, """
                        {"minLeadTimeHours": 200, "maxAdvanceDays": 400,
                         "cancellationCutoffHours": 24, "slotGranularityMinutes": 15}
                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errors[0].field").value("maxAdvanceDays"))
                .andExpect(jsonPath("$.errors[1].field").value("minLeadTimeHours"));

        mockMvc.perform(asOwner(put("/api/policy"), tenant, """
                        {"minLeadTimeHours": 2, "maxAdvanceDays": 0,
                         "cancellationCutoffHours": 24, "slotGranularityMinutes": 15}
                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errors[0].field").value("maxAdvanceDays"));
    }

    @Test
    @DisplayName("the policy a caller reads is their own tenant's")
    void thePolicyIsTenantScoped() throws Exception {
        Tenant mine = aTenant();
        Tenant elsewhere = aTenant();

        mockMvc.perform(asOwner(put("/api/policy"), elsewhere, """
                        {"minLeadTimeHours": 6, "maxAdvanceDays": 10,
                         "cancellationCutoffHours": 6, "slotGranularityMinutes": 60}
                        """))
                .andExpect(status().isOk());

        // There is no id in the path to substitute, which is the whole reason these two endpoints
        // need no tenant guard — but it is worth one assertion that the token is what selects the row.
        mockMvc.perform(asOwner(get("/api/policy"), mine, null))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slotGranularityMinutes").value(15));
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    /** The one field these tests read out of the body rather than matching in place. */
    private static String updatedAt(ResultActions response) throws Exception {
        return JsonPath.read(response.andReturn().getResponse().getContentAsString(), "$.updatedAt");
    }

    private static String settings(String timezone) {
        return """
                {"name": "Dana Clinic", "timezone": "%s", "currency": "EUR",
                 "depositRequired": false, "depositPercent": 0}
                """.formatted(timezone);
    }

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
