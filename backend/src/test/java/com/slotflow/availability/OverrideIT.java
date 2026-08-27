package com.slotflow.availability;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.staff.User;
import com.slotflow.support.ApiIntegrationTest;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * The override endpoints — {@code exceptions} on the wire, {@link AvailabilityOverride} in the code.
 *
 * <p>Three things are being pinned here: what a whole day means at each level, that a business-wide
 * closure is one row every member of the team can see (D5), and that the shapes with no meaning are
 * refused as 422s naming a field rather than as 500s from an entity constructor.
 */
class OverrideIT extends ApiIntegrationTest {

    @Autowired
    private AvailabilityOverrideRepository overrides;

    // ---------------------------------------------------------------------------------
    //  staff-level
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("a whole day off and an afternoon off are the same row with and without times")
    void staffLevelBlocks() throws Exception {
        Tenant tenant = aTenant();
        User colleague = aStaffMemberOf(tenant);

        mockMvc.perform(asOwner(post(staffExceptions(colleague)), tenant, """
                        {"date": "2026-03-05", "type": "BLOCKED", "reason": "Annual leave"}
                        """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.staffId").value(colleague.getId().toString()))
                .andExpect(jsonPath("$.businessWide").value(false))
                .andExpect(jsonPath("$.wholeDay").value(true))
                .andExpect(jsonPath("$.type").value("BLOCKED"))
                .andExpect(jsonPath("$.reason").value("Annual leave"))
                // Absent rather than null: the convention is that a field the server has nothing to
                // say about does not appear, which is exactly why wholeDay is on the record too.
                .andExpect(jsonPath("$.startTime").doesNotExist());

        mockMvc.perform(asOwner(post(staffExceptions(colleague)), tenant, """
                        {"date": "2026-03-06", "startTime": "14:00", "endTime": "18:00",
                         "type": "BLOCKED", "reason": "Dentist"}
                        """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.wholeDay").value(false))
                .andExpect(jsonPath("$.startTime").value("14:00:00"))
                .andExpect(jsonPath("$.endTime").value("18:00:00"));
    }

    @Test
    @DisplayName("EXTRA hours are accepted as a range and refused as a whole day")
    void extraHoursMustNameARange() throws Exception {
        Tenant tenant = aTenant();

        mockMvc.perform(asOwner(post(staffExceptions(tenant.owner())), tenant, """
                        {"date": "2026-03-07", "startTime": "10:00", "endTime": "14:00",
                         "type": "EXTRA", "reason": "Saturday opening"}
                        """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.type").value("EXTRA"));

        // "Available, from no time until no time" is a sentence with no meaning, and the schema
        // refuses it too. A 422 naming startTime, not a 500 from the entity's factory.
        mockMvc.perform(asOwner(post(staffExceptions(tenant.owner())), tenant, """
                        {"date": "2026-03-08", "type": "EXTRA"}
                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("startTime"));
    }

    @Test
    @DisplayName("one time without the other, and a zero-length range, are both refused")
    void incoherentTimesAreRefused() throws Exception {
        Tenant tenant = aTenant();

        mockMvc.perform(asOwner(post(staffExceptions(tenant.owner())), tenant, """
                        {"date": "2026-03-09", "startTime": "10:00", "type": "BLOCKED"}
                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errors[0].field").value("endTime"));

        mockMvc.perform(asOwner(post(staffExceptions(tenant.owner())), tenant, """
                        {"date": "2026-03-09", "startTime": "10:00", "endTime": "10:00",
                         "type": "BLOCKED"}
                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errors[0].field").value("endTime"));
    }

    @Test
    @DisplayName("overlapping overrides on one date are allowed: the engine resolves precedence")
    void overlappingOverridesAreAllowed() throws Exception {
        Tenant tenant = aTenant();

        // Deliberately not validated. BLOCKED wins over EXTRA whatever the level (plan 09), and a
        // configuration API that refused every combination it could not itself interpret would
        // refuse the ordinary case of a closure with one person's extra hours layered on it.
        mockMvc.perform(asOwner(post(staffExceptions(tenant.owner())), tenant, """
                        {"date": "2026-03-10", "startTime": "09:00", "endTime": "17:00",
                         "type": "BLOCKED"}
                        """))
                .andExpect(status().isCreated());
        mockMvc.perform(asOwner(post(staffExceptions(tenant.owner())), tenant, """
                        {"date": "2026-03-10", "startTime": "10:00", "endTime": "12:00",
                         "type": "EXTRA"}
                        """))
                .andExpect(status().isCreated());
    }

    @Test
    @DisplayName("a staff member manages their own overrides and nobody else's")
    void staffManageOnlyTheirOwn() throws Exception {
        Tenant tenant = aTenant();
        User colleague = aStaffMemberOf(tenant);
        String dayOff = """
                {"date": "2026-03-11", "type": "BLOCKED"}
                """;

        UUID own = idOf(mockMvc.perform(as(post(staffExceptions(colleague)), colleague, dayOff))
                .andExpect(status().isCreated()));

        mockMvc.perform(as(post(staffExceptions(tenant.owner())), colleague, dayOff))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));

        mockMvc.perform(as(delete(staffExceptions(colleague) + "/" + own), colleague, null))
                .andExpect(status().isNoContent());
        assertThat(overrides.findById(own)).isEmpty();
    }

    @Test
    @DisplayName("a colleague's override id under my own path is not found")
    void anOverrideBelongsToOnePerson() throws Exception {
        Tenant tenant = aTenant();
        User colleague = aStaffMemberOf(tenant);
        UUID theirs = idOf(mockMvc.perform(asOwner(post(staffExceptions(colleague)), tenant, """
                        {"date": "2026-03-12", "type": "BLOCKED"}
                        """))
                .andExpect(status().isCreated()));

        // The staff id in the path is checked against the row rather than trusted. Without it a
        // staff member could delete a colleague's day off through their own path, and the
        // authorisation check would have passed.
        mockMvc.perform(asOwner(delete(staffExceptions(tenant.owner()) + "/" + theirs), tenant, null))
                .andExpect(status().isNotFound());
        assertThat(overrides.findById(theirs)).isPresent();
    }

    // ---------------------------------------------------------------------------------
    //  business-wide (D5)
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("an owner closes the whole business, and every staff member sees it")
    void aBusinessWideClosureAppliesToEveryone() throws Exception {
        Tenant tenant = aTenant();
        User colleague = aStaffMemberOf(tenant);

        mockMvc.perform(asOwner(post("/api/exceptions"), tenant, """
                        {"date": "2026-12-25", "type": "BLOCKED", "reason": "Christmas Day"}
                        """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.businessWide").value(true))
                .andExpect(jsonPath("$.wholeDay").value(true))
                // No staff id at all, which is what makes it cover whoever joins next year too.
                .andExpect(jsonPath("$.staffId").doesNotExist());

        // One row, visible to the whole team through the merged view — not fanned out into a copy
        // per staff member, which would be a closure that can be half-deleted.
        mockMvc.perform(as(get("/api/exceptions?from=2026-12-01&to=2026-12-31"), colleague, null))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].businessWide").value(true))
                .andExpect(jsonPath("$[0].reason").value("Christmas Day"));
    }

    @Test
    @DisplayName("a business-wide closure can cover part of a day")
    void aBusinessWideClosureCanBeARange() throws Exception {
        Tenant tenant = aTenant();

        mockMvc.perform(asOwner(post("/api/exceptions"), tenant, """
                        {"date": "2026-04-01", "startTime": "12:00", "endTime": "14:00",
                         "type": "BLOCKED", "reason": "Staff meeting"}
                        """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.businessWide").value(true))
                .andExpect(jsonPath("$.wholeDay").value(false))
                .andExpect(jsonPath("$.startTime").value("12:00:00"));
    }

    @Test
    @DisplayName("a business cannot declare its staff available on their behalf")
    void aBusinessWideExtraIsRefused() throws Exception {
        Tenant tenant = aTenant();

        // BLOCKED business-wide is a public holiday; EXTRA business-wide would put everybody on the
        // booking page for hours nobody agreed to work. Extra hours stay per person.
        mockMvc.perform(asOwner(post("/api/exceptions"), tenant, """
                        {"date": "2026-04-02", "startTime": "18:00", "endTime": "21:00",
                         "type": "EXTRA"}
                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("type"));
    }

    @Test
    @DisplayName("only an owner may close the business or delete from the merged calendar")
    void businessWideWritesAreOwnerOnly() throws Exception {
        Tenant tenant = aTenant();
        User colleague = aStaffMemberOf(tenant);
        UUID closure = idOf(mockMvc.perform(asOwner(post("/api/exceptions"), tenant, """
                        {"date": "2026-05-01", "type": "BLOCKED", "reason": "Labour Day"}
                        """))
                .andExpect(status().isCreated()));

        mockMvc.perform(as(post("/api/exceptions"), colleague, """
                        {"date": "2026-05-02", "type": "BLOCKED"}
                        """))
                .andExpect(status().isForbidden());
        mockMvc.perform(as(delete("/api/exceptions/" + closure), colleague, null))
                .andExpect(status().isForbidden());

        // The delete button on the merged calendar reaches both levels, for an owner.
        mockMvc.perform(asOwner(delete("/api/exceptions/" + closure), tenant, null))
                .andExpect(status().isNoContent());
        assertThat(overrides.findById(closure)).isEmpty();
    }

    // ---------------------------------------------------------------------------------
    //  the merged view
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("the merged view carries both levels, in calendar order, inside the range")
    void theMergedViewIsBothLevels() throws Exception {
        Tenant tenant = aTenant();
        User colleague = aStaffMemberOf(tenant);

        mockMvc.perform(asOwner(post(staffExceptions(colleague)), tenant, """
                        {"date": "2026-06-10", "startTime": "14:00", "endTime": "18:00",
                         "type": "BLOCKED", "reason": "Dentist"}
                        """))
                .andExpect(status().isCreated());
        mockMvc.perform(asOwner(post("/api/exceptions"), tenant, """
                        {"date": "2026-06-10", "type": "BLOCKED", "reason": "Closed"}
                        """))
                .andExpect(status().isCreated());
        mockMvc.perform(asOwner(post(staffExceptions(tenant.owner())), tenant, """
                        {"date": "2026-07-01", "type": "BLOCKED", "reason": "Out of range"}
                        """))
                .andExpect(status().isCreated());

        mockMvc.perform(asOwner(get("/api/exceptions?from=2026-06-01&to=2026-06-30"), tenant, null))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                // Closures first on a date, because that is what the calendar draws across the top.
                .andExpect(jsonPath("$[0].businessWide").value(true))
                .andExpect(jsonPath("$[1].reason").value("Dentist"));
    }

    @Test
    @DisplayName("a range that runs backwards is refused, and the parameters are required")
    void theRangeIsValidated() throws Exception {
        Tenant tenant = aTenant();

        mockMvc.perform(asOwner(get("/api/exceptions?from=2026-06-30&to=2026-06-01"), tenant, null))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errors[0].field").value("to"));

        mockMvc.perform(asOwner(get("/api/exceptions?from=2026-06-01"), tenant, null))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("MISSING_PARAMETER"));
    }

    @Test
    @DisplayName("another tenant's overrides are not in my merged view")
    void theMergedViewIsTenantScoped() throws Exception {
        Tenant mine = aTenant();
        Tenant elsewhere = aTenant();
        mockMvc.perform(asOwner(post("/api/exceptions"), elsewhere, """
                        {"date": "2026-08-15", "type": "BLOCKED", "reason": "Their closure"}
                        """))
                .andExpect(status().isCreated());

        mockMvc.perform(asOwner(get("/api/exceptions?from=2026-08-01&to=2026-08-31"), mine, null))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    private UUID idOf(ResultActions result) throws Exception {
        return UUID.fromString(json.readTree(
                result.andReturn().getResponse().getContentAsString())
                .get("id").asText());
    }

    private static String staffExceptions(User staff) {
        return "/api/staff/" + staff.getId() + "/exceptions";
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
