package com.slotflow.staff;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.catalog.ServiceOffering;
import com.slotflow.catalog.ServiceOfferingRepository;
import com.slotflow.catalog.StaffService;
import com.slotflow.catalog.StaffServiceRepository;
import com.slotflow.support.ApiIntegrationTest;
import com.slotflow.support.fixtures.Fixtures;
import java.util.Locale;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MvcResult;

/**
 * D9: {@code GET /api/public/businesses/{slug}/staff}, the unauthenticated list the booking page
 * calls at step 2.
 *
 * <p>The assertion that matters is made <b>on the raw JSON string</b>, not on a deserialised object.
 * A test that maps the response back into {@link PublicStaffResponse} cannot fail when the endpoint
 * starts returning an email address, because the mapping simply drops the extra field — which is
 * exactly the shape of the accident this endpoint has to be protected from.
 */
class PublicStaffEndpointIT extends ApiIntegrationTest {

    @Autowired
    private ServiceOfferingRepository services;

    @Autowired
    private StaffServiceRepository assignments;

    @Test
    @DisplayName("the public response carries an id and a display name, and no PII")
    void thePublicResponseIsIdAndNameOnly() throws Exception {
        Tenant tenant = aTenant();
        User colleague = aStaffMemberOf(tenant);

        MvcResult result = mockMvc.perform(publicStaff(tenant))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].id").exists())
                .andExpect(jsonPath("$[0].displayName").exists())
                // Two members per entry, so a third one cannot arrive unnoticed.
                .andExpect(jsonPath("$[0].length()").value(2))
                .andReturn();

        String body = result.getResponse().getContentAsString();
        assertThat(body)
                .doesNotContain(tenant.owner().getEmail())
                .doesNotContain(colleague.getEmail())
                .doesNotContain("@example.test")
                .doesNotContain("email")
                .doesNotContain("role")
                .doesNotContain("OWNER")
                .doesNotContain("active");
        assertThat(body).contains(colleague.getFullName());
    }

    @Test
    @DisplayName("a deactivated colleague disappears from the booking page immediately")
    void deactivatedStaffAreHidden() throws Exception {
        Tenant tenant = aTenant();
        User colleague = aStaffMemberOf(tenant);
        colleague.deactivate();
        users.save(colleague);

        mockMvc.perform(publicStaff(tenant))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(tenant.owner().getId().toString()));
    }

    @Test
    @DisplayName("an invited colleague who has not accepted is not bookable either")
    void pendingInviteesAreHidden() throws Exception {
        Tenant tenant = aTenant();
        users.save(Fixtures.aStaffMember().forBusiness(tenant.business()).invited().build());

        mockMvc.perform(publicStaff(tenant))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    @DisplayName("?serviceId= narrows the list to the people who perform it")
    void theServiceFilterNarrowsTheList() throws Exception {
        Tenant tenant = aTenant();
        User colleague = aStaffMemberOf(tenant);
        ServiceOffering massage = services.save(
                Fixtures.aService().forBusiness(tenant.business()).build());
        assignments.save(new StaffService(
                tenant.business().getId(), colleague.getId(), massage.getId()));

        mockMvc.perform(get("/api/public/businesses/" + tenant.business().getSlug() + "/staff")
                .param("serviceId", massage.getId().toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(colleague.getId().toString()));
    }

    @Test
    @DisplayName("another tenant's service id yields an empty list, not their staff")
    void theServiceFilterCannotCrossTenants() throws Exception {
        Tenant mine = aTenant();
        Tenant elsewhere = aTenant();
        User theirStaff = aStaffMemberOf(elsewhere);
        ServiceOffering theirService = services.save(
                Fixtures.aService().forBusiness(elsewhere.business()).build());
        assignments.save(new StaffService(
                elsewhere.business().getId(), theirStaff.getId(), theirService.getId()));

        // The intersection with my own team is the isolation: there is no ownership check to forget,
        // because a foreign service simply has no performers inside this business.
        mockMvc.perform(get("/api/public/businesses/" + mine.business().getSlug() + "/staff")
                .param("serviceId", theirService.getId().toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    @DisplayName("the slug in the path is matched however the customer typed it")
    void theSlugIsNormalisedAtTheBoundary() throws Exception {
        Tenant tenant = aTenant();
        String slug = tenant.business().getSlug();

        // RegisterRequest accepts ^[A-Za-z0-9-]{3,40}$ and its javadoc promises "Dana-Clinic" is a
        // usable answer, because Business lower-cases before it checks the schema's own
        // ^[a-z0-9-]{3,40}$. So the stored slug is lower case and the URL a business puts on a
        // card, or a browser capitalises, or a customer types by hand, need not be — and an exact
        // match answers 404 for a business that plainly exists.
        mockMvc.perform(get("/api/public/businesses/" + slug.toUpperCase(Locale.ROOT) + "/staff"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(tenant.owner().getId().toString()));
    }

    @Test
    @DisplayName("an unknown slug is a 404 problem detail")
    void unknownSlugIsNotFound() throws Exception {
        mockMvc.perform(get("/api/public/businesses/no-such-clinic/staff"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
    }

    @Test
    @DisplayName("no token is needed, and a stale one does not break it")
    void theEndpointIsPublic() throws Exception {
        Tenant tenant = aTenant();

        // Public means public: the booking page has no session, and a leftover Authorization header
        // from another tab must not turn a public read into a 401.
        mockMvc.perform(publicStaff(tenant).header("Authorization", "Bearer not-a-real-token"))
                .andExpect(status().isOk());
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder publicStaff(
            Tenant tenant) {
        return get("/api/public/businesses/" + tenant.business().getSlug() + "/staff");
    }
}
