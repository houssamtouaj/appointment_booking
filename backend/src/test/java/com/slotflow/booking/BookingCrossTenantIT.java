package com.slotflow.booking;

import static com.slotflow.support.fixtures.Fixtures.aBooking;
import static com.slotflow.support.fixtures.Fixtures.aService;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.catalog.ServiceOffering;
import com.slotflow.catalog.ServiceOfferingRepository;
import com.slotflow.support.CrossTenantTestBase;
import com.slotflow.support.TestTime;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;

/**
 * No request reaches another tenant's bookings, under any filter combination.
 *
 * <p>The two id-shaped endpoints go through {@link CrossTenantTestBase}, which asserts the split
 * this API draws everywhere: a read of a foreign id is {@code 404} because a {@code 403} would
 * confirm the row exists, and a write is {@code 403} because the caller is authenticated and being
 * refused. Each case is paired with the equivalent call inside the caller's own tenant, so a typo in
 * a path cannot masquerade as a security guarantee.
 *
 * <p>The list endpoint needs its own test, because a list has no foreign id to name — the attack is
 * a filter. {@code ?staffId=} pointing at another tenant's staff member is the interesting one: it
 * is a legal uuid, it identifies a real person, and the honest answer is an empty page rather than
 * an error, because an error is an existence oracle by another route.
 */
class BookingCrossTenantIT extends CrossTenantTestBase {

    @Autowired
    private ServiceOfferingRepository services;

    @Autowired
    private BookingRepository bookings;

    @Override
    protected List<CrossTenantCase> crossTenantCases() {
        // In the past, so that the COMPLETED write below is a legal move rather than a 409 about
        // the time guard — which would pass the "refused" half of the harness for the wrong reason
        // and fail the "reachable in my own tenant" control.
        Booking mineBooking = aBookingIn(mine, TestTime.NOW.minus(Duration.ofDays(2)));
        Booking theirBooking = aBookingIn(theirs, TestTime.NOW.minus(Duration.ofDays(3)));

        return List.of(
                CrossTenantCase.read("/api/bookings/" + theirBooking.getId(),
                        "/api/bookings/" + mineBooking.getId()),
                CrossTenantCase.write(HttpMethod.PATCH,
                        "/api/bookings/" + theirBooking.getId() + "/status",
                        "/api/bookings/" + mineBooking.getId() + "/status",
                        "{\"status\": \"COMPLETED\"}"));
    }

    @Test
    @DisplayName("no filter combination returns a foreign row, including a foreign staffId")
    void theListIsScopedWhateverIsFilteredOn() throws Exception {
        Booking own = aBookingIn(mine, TestTime.NOW.plus(Duration.ofDays(1)));
        Booking foreign = aBookingIn(theirs, TestTime.NOW.plus(Duration.ofDays(1)));

        // Unfiltered: my row and only my row.
        assertThat(idsFrom("")).contains(own.getId().toString())
                .doesNotContain(foreign.getId().toString());

        // Every filter the endpoint takes, aimed at the other tenant's data. A foreign staff id is
        // ANDed with my business id, so it selects nothing — not a 403, which would confirm that
        // the staff member exists.
        for (String query : List.of(
                "?staffId=" + foreign.getStaffId(),
                "?status=CONFIRMED",
                "?from=" + TestTime.NOW + "&to=" + TestTime.NOW.plus(Duration.ofDays(30)),
                "?staffId=" + foreign.getStaffId() + "&status=CONFIRMED",
                "?staffId=" + foreign.getStaffId() + "&from=" + TestTime.NOW
                        + "&to=" + TestTime.NOW.plus(Duration.ofDays(30)) + "&status=CONFIRMED")) {
            assertThat(idsFrom(query))
                    .as("GET /api/bookings%s", query)
                    .doesNotContain(foreign.getId().toString());
        }

        // The control: the same staffId filter aimed at my own team does return something, so the
        // assertions above are about tenancy rather than about a filter that matches nothing.
        assertThat(idsFrom("?staffId=" + own.getStaffId()))
                .contains(own.getId().toString());
    }

    @Test
    @DisplayName("a foreign booking id reads as 404 and writes as 403, and neither leaks the row")
    void aForeignIdIsRefusedFromBothDirections() throws Exception {
        Booking foreign = aBookingIn(theirs, TestTime.NOW.plus(Duration.ofDays(2)));

        mockMvc.perform(get("/api/bookings/{id}", foreign.getId())
                .header(HttpHeaders.AUTHORIZATION, bearer(mine.owner())))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"))
                // Not one field of the row, not even in the message: the point of the 404 is that
                // the caller learns nothing, including whether there was anything to learn.
                .andExpect(jsonPath("$.detail").value("The requested resource does not exist."));

        assertThat(bookings.findById(foreign.getId()).orElseThrow().getStatus())
                .isEqualTo(BookingStatus.CONFIRMED);
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    private Booking aBookingIn(Tenant tenant, Instant startsAt) {
        ServiceOffering service = services.save(
                aService().forBusiness(tenant.business()).build());
        return bookings.save(aBooking().forService(service).withStaff(tenant.owner())
                .at(startsAt).build());
    }

    private List<String> idsFrom(String query) throws Exception {
        String body = mockMvc.perform(get("/api/bookings" + query)
                .header(HttpHeaders.AUTHORIZATION, bearer(mine.owner())))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return json.readTree(body).path("content").findValuesAsText("id");
    }
}
