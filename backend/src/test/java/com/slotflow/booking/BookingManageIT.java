package com.slotflow.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.business.BookingPolicy;
import com.slotflow.support.BookingScenario;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;

/**
 * The manage page: what a customer can see and do with nothing but the link in their inbox.
 *
 * <p>Two things are being asserted here that are easy to get wrong and impossible to notice
 * afterwards. The first is the cutoff, which has to refuse <em>and</em> say when the deadline was —
 * a customer who is told only "no" rings the shop, which is the outcome the online cancel exists to
 * avoid. The second is D7: {@code depositRefundable: false} has to be on the page before the click
 * and in the response to the click, because "the money is kept either way" is a thing that must be
 * disclosed rather than discovered.
 *
 * <p>The privacy tests at the bottom are the other half. Guest contact details are the most
 * sensitive data in the schema (D1: there is no account behind them, so they <em>are</em> the
 * customer) and they appear in exactly two responses. Those tests read the raw JSON rather than a
 * deserialised object, because a leaked field is precisely the field a DTO-shaped assertion cannot
 * see.
 */
class BookingManageIT extends BookingScenario {

    @Test
    @DisplayName("the token is the whole credential, and the page it opens says what it costs")
    void theManagePage() throws Exception {
        Salon salon = solo(aSalon());
        PublicBookingResponse created = bookOk(salon, NINE_AM);

        mockMvc.perform(get("/api/public/bookings/{token}", created.cancellationToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(created.id().toString()))
                .andExpect(jsonPath("$.status").value("CONFIRMED"))
                .andExpect(jsonPath("$.startsAt").value("2026-03-04T08:00:00Z"))
                // D7, next to the button rather than in a terms page somewhere.
                .andExpect(jsonPath("$.depositRefundable").value(false))
                // The default cutoff is 24 hours, and the page renders the deadline rather than
                // recomputing it: two implementations of one policy is one too many.
                .andExpect(jsonPath("$.cancellable").value(true))
                .andExpect(jsonPath("$.cancellationDeadline").value("2026-03-03T08:00:00Z"))
                // Only here, and only behind the token.
                .andExpect(jsonPath("$.guest.name").value("Alex Guest"))
                .andExpect(jsonPath("$.guest.email").value("alex@example.test"))
                .andExpect(jsonPath("$.guest.phone").value("+33 1 23 45 67 89"));
    }

    @Test
    @DisplayName("an unknown token is 404, exactly like a cancelled one that was never issued")
    void anUnknownTokenIsNotFound() throws Exception {
        mockMvc.perform(get("/api/public/bookings/{token}", UUID.randomUUID()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));

        mockMvc.perform(delete("/api/public/bookings/{token}", UUID.randomUUID()))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("past the cutoff, cancelling is 409 with the deadline in the body")
    void theCancellationCutoff() throws Exception {
        Salon salon = solo(aSalon());
        PublicBookingResponse created = bookOk(salon, NINE_AM);

        // One minute inside the 24-hour cutoff. Landing exactly on the deadline is also too late —
        // the boundary has to fall one way, and refusing is the side that cannot surprise a
        // business that has already turned other customers away.
        clock.setTo(NINE_AM.minus(Duration.ofHours(24)).plus(Duration.ofMinutes(1)));

        mockMvc.perform(get("/api/public/bookings/{token}", created.cancellationToken()))
                .andExpect(jsonPath("$.cancellable").value(false));

        mockMvc.perform(delete("/api/public/bookings/{token}", created.cancellationToken()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CANCELLATION_CUTOFF"))
                .andExpect(jsonPath("$.deadline").value("2026-03-03T08:00:00Z"))
                .andExpect(jsonPath("$.depositRefundable").value(false));

        assertThat(bookings.findById(created.id()).orElseThrow().getStatus())
                .isEqualTo(BookingStatus.CONFIRMED);
    }

    @Test
    @DisplayName("cancelling twice is 409 ILLEGAL_TRANSITION, not a second success")
    void cancellingTwice() throws Exception {
        Salon salon = solo(aSalon());
        PublicBookingResponse created = bookOk(salon, NINE_AM);

        mockMvc.perform(delete("/api/public/bookings/{token}", created.cancellationToken()))
                .andExpect(status().isOk());
        mockMvc.perform(delete("/api/public/bookings/{token}", created.cancellationToken()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ILLEGAL_TRANSITION"))
                .andExpect(jsonPath("$.from").value("CANCELLED"));
    }

    @Test
    @DisplayName("a zero-hour cutoff still refuses at the start time, and allows a minute before")
    void theCutoffBoundary() throws Exception {
        Salon salon = solo(aSalon());
        BookingPolicy policy = policies.findById(salon.businessId()).orElseThrow();
        policy.setCancellationCutoffHours(0);
        policies.save(policy);
        PublicBookingResponse created = bookOk(salon, NINE_AM);

        clock.setTo(NINE_AM);
        mockMvc.perform(delete("/api/public/bookings/{token}", created.cancellationToken()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CANCELLATION_CUTOFF"));

        clock.setTo(NINE_AM.minus(Duration.ofMinutes(1)));
        mockMvc.perform(delete("/api/public/bookings/{token}", created.cancellationToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"));
    }

    // ---------------------------------------------------------------------------------
    //  privacy (D1)
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("no public response but the token lookup carries a guest email address")
    void guestContactDetailsStayBehindTheToken() throws Exception {
        Salon salon = solo(aSalon());

        String creation = book(salon, NINE_AM)
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        assertThat(creation)
                .as("the customer typed these into the request; reading them back gains them "
                        + "nothing and puts them in one more place")
                .doesNotContain("alex@example.test")
                .doesNotContain("Alex Guest")
                .doesNotContain("guest");

        // The calendar the whole internet can poll says who is free, never who is booked.
        String availability = mockMvc.perform(availabilityRequest(salon, WEDNESDAY))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(availability).doesNotContain("alex@example.test").doesNotContain("Alex Guest");

        String token = json.readValue(creation, PublicBookingResponse.class)
                .cancellationToken().toString();
        assertThat(mockMvc.perform(get("/api/public/bookings/{token}", token))
                .andReturn().getResponse().getContentAsString())
                .as("and here, where the credential is the whole point, they are present")
                .contains("alex@example.test");
    }

    @Test
    @DisplayName("the admin list carries a name, and the email address only on the detail view")
    void theAdminListDoesNotCarryContactDetails() throws Exception {
        Salon salon = solo(aSalon());
        PublicBookingResponse created = bookOk(salon, NINE_AM);

        String list = mockMvc.perform(get("/api/bookings")
                        .header(HttpHeaders.AUTHORIZATION, bearer(salon.dana())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].guestName").value("Alex Guest"))
                .andReturn().getResponse().getContentAsString();
        assertThat(list)
                .as("a leak on a page of forty rows is forty leaks; the detail view is one")
                .doesNotContain("alex@example.test")
                .doesNotContain("+33 1 23 45 67 89");

        mockMvc.perform(get("/api/bookings/{id}", created.id())
                        .header(HttpHeaders.AUTHORIZATION, bearer(salon.dana())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.guest.email").value("alex@example.test"))
                .andExpect(jsonPath("$.guest.phone").value("+33 1 23 45 67 89"))
                // The blocked window is on this view and on no other: the customer books sixty
                // minutes, and the ninety the calendar loses belong to the person whose day it is.
                .andExpect(jsonPath("$.blockedFrom").exists())
                .andExpect(jsonPath("$.blockedTo").exists());
    }
}
