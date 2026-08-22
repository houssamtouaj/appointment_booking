package com.slotflow.booking;

import static com.slotflow.support.fixtures.Fixtures.aBooking;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.staff.User;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * {@code GET /api/bookings}: the four filters, how they combine, and the order rows come back in.
 *
 * <p>Tenant isolation is {@code BookingCrossTenantIT}'s subject and is not repeated here. What this
 * class pins down is that the filters mean what the OpenAPI description says they mean —
 * {@code from} inclusive, {@code to} exclusive, so two adjacent day queries neither overlap nor
 * leave a gap — and that the page is ordered rather than being whatever order Postgres happened to
 * find the rows in, which is the bug where page 2 repeats a row from page 1 and drops another.
 */
class BookingListIT extends BookingScenario {

    @Test
    @DisplayName("from is inclusive and to is exclusive, so adjacent windows tile the calendar")
    void theDateWindowIsHalfOpen() throws Exception {
        Salon salon = aSalon();
        Instant wednesday = parisTime("2026-03-04T09:00");
        Instant thursday = parisTime("2026-03-05T09:00");
        Booking onWednesday = save(salon, salon.dana(), wednesday);
        Booking onThursday = save(salon, salon.dana(), thursday);

        assertThat(idsFrom(list(salon)
                .param("from", wednesday.toString())
                .param("to", thursday.toString())))
                .as("the row starting exactly at `to` belongs to the next window, not this one")
                .containsExactly(onWednesday.getId().toString());

        assertThat(idsFrom(list(salon).param("from", thursday.toString())))
                .containsExactly(onThursday.getId().toString());
    }

    @Test
    @DisplayName("status and staffId narrow the page, and combine with the window")
    void theOtherTwoFilters() throws Exception {
        Salon salon = aSalon();
        Booking danaMorning = save(salon, salon.dana(), parisTime("2026-03-04T09:00"));
        Booking samMorning = save(salon, salon.sam(), parisTime("2026-03-04T09:00"));
        Booking danaAfternoon = save(salon, salon.dana(), parisTime("2026-03-04T15:00"));
        danaAfternoon.cancel();
        bookings.save(danaAfternoon);

        assertThat(idsFrom(list(salon).param("staffId", salon.dana().getId().toString())))
                .containsExactly(danaMorning.getId().toString(), danaAfternoon.getId().toString());

        // No status filter means every status, cancelled rows included: this is a record of what
        // happened, and a day view that silently hid cancellations would make an afternoon that was
        // booked and dropped look like one nobody ever wanted.
        assertThat(idsFrom(list(salon))).contains(danaAfternoon.getId().toString());

        assertThat(idsFrom(list(salon).param("status", "CANCELLED")))
                .containsExactly(danaAfternoon.getId().toString());
        assertThat(idsFrom(list(salon)
                .param("status", "CONFIRMED")
                .param("staffId", salon.sam().getId().toString())))
                .containsExactly(samMorning.getId().toString());
        assertThat(idsFrom(list(salon).param("status", "COMPLETED"))).isEmpty();
    }

    @Test
    @DisplayName("rows come back by start time, in the envelope every list in this API uses")
    void theOrderAndTheEnvelope() throws Exception {
        Salon salon = aSalon();
        // Saved out of order on purpose.
        Booking third = save(salon, salon.dana(), parisTime("2026-03-04T15:00"));
        Booking first = save(salon, salon.dana(), parisTime("2026-03-04T09:00"));
        Booking second = save(salon, salon.sam(), parisTime("2026-03-04T11:00"));

        mockMvc.perform(list(salon).param("size", "2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(2))
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.totalPages").value(2))
                .andExpect(jsonPath("$.content[0].id").value(first.getId().toString()))
                .andExpect(jsonPath("$.content[1].id").value(second.getId().toString()));

        mockMvc.perform(list(salon).param("size", "2").param("page", "1"))
                .andExpect(jsonPath("$.content[0].id").value(third.getId().toString()));
    }

    @Test
    @DisplayName("an anonymous caller gets a 401, never an empty page")
    void theListNeedsAToken() throws Exception {
        mockMvc.perform(get("/api/bookings"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    private MockHttpServletRequestBuilder list(Salon salon) {
        return get("/api/bookings")
                .header(HttpHeaders.AUTHORIZATION, bearer(salon.dana()));
    }

    private Booking save(Salon salon, User staff, Instant startsAt) {
        return bookings.save(aBooking().forService(salon.service()).withStaff(staff)
                .at(startsAt).build());
    }

    private List<String> idsFrom(MockHttpServletRequestBuilder request) throws Exception {
        String body = mockMvc.perform(request.param("size", "100"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return json.readTree(body).path("content").findValuesAsText("id");
    }
}
