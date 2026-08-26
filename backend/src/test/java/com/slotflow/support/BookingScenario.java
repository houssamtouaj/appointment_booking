package com.slotflow.support;

import static com.slotflow.support.fixtures.Fixtures.aService;
import static com.slotflow.support.fixtures.Fixtures.workingHours;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.availability.WorkingHoursRepository;
import com.slotflow.booking.BookingRepository;
import com.slotflow.booking.PublicBookingResponse;
import com.slotflow.business.BookingPolicy;
import com.slotflow.catalog.ServiceOffering;
import com.slotflow.catalog.ServiceOfferingRepository;
import com.slotflow.catalog.StaffService;
import com.slotflow.catalog.StaffServiceRepository;
import com.slotflow.staff.User;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * The salon every booking test books at, and the requests they make against it.
 *
 * <p>Deliberately a plain superclass with no {@code @TestConfiguration} and no
 * {@code @TestPropertySource} of its own, so that every subclass keeps sharing the one application
 * context {@code IntegrationTest} pays for. It adds fixtures and request builders, nothing else.
 *
 * <p>It lives in {@code support} rather than beside the booking tests because three packages' tests
 * now book something: the booking flow itself, the notifications that hang off it (plan 12), and
 * the deposit path (plan 11). A fixture that half the suite extends is harness, not a detail of one
 * package.
 *
 * <p><b>Wednesday, not Monday.</b> {@code TestTime.NOW} is Monday 09:00 UTC — ten in the morning in
 * Paris — so half of Monday is already behind the lead time, and a test whose expected answer moves
 * with the policy is a test about the wrong thing. Wednesday is a clean 09:00–17:00 day in the
 * business zone, which is 08:00–16:00 UTC in early March.
 */
public abstract class BookingScenario extends ApiIntegrationTest {

    protected static final ZoneId PARIS = ZoneId.of("Europe/Paris");

    protected static final LocalDate WEDNESDAY = LocalDate.of(2026, 3, 4);

    /** The first bookable start of that Wednesday: 09:00 Paris. */
    protected static final Instant NINE_AM = parisTime("2026-03-04T09:00");

    @Autowired
    protected ServiceOfferingRepository services;

    @Autowired
    protected StaffServiceRepository assignments;

    @Autowired
    protected WorkingHoursRepository workingHours;

    @Autowired
    protected BookingRepository bookings;

    /** Two staff on the same weekday template, one bookable service. */
    protected record Salon(Tenant tenant, ServiceOffering service, User dana, User sam) {

        public UUID businessId() {
            return tenant.id();
        }

        public String slug() {
            return tenant.business().getSlug();
        }

        public UUID serviceId() {
            return service.getId();
        }
    }

    protected Salon aSalon() {
        return aSalonWithBuffers(0, 0);
    }

    /**
     * A salon with a half-hour grid and no lead time.
     *
     * <p>Both are overrides of the defaults, and both are so that the assertions in these tests are
     * about booking rather than about policy: a fifteen-minute grid makes every expected slot list
     * twice as long, and the two-hour lead time would silently swallow the first two hours of any
     * test that used today.
     */
    protected Salon aSalonWithBuffers(int before, int after) {
        Tenant tenant = aTenant();
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
        return new Salon(tenant, haircut, tenant.owner(), sam);
    }

    /**
     * Narrows a salon to Dana alone, which is what a race for one slot needs: with two staff
     * available, two simultaneous any-staff bookings are correctly served by two different people
     * and there is no conflict to observe.
     *
     * <p>Sam is deactivated rather than unassigned, because that is the one-line spelling the
     * application itself supports and it leaves the assignment row alone (plan 06).
     */
    protected Salon solo(Salon salon) {
        User sam = salon.sam();
        sam.deactivate();
        users.save(sam);
        return salon;
    }

    // ---------------------------------------------------------------------------------
    //  requests
    // ---------------------------------------------------------------------------------

    protected static String bookingsPath(String slug) {
        return "/api/public/businesses/" + slug + "/bookings";
    }

    /** The whole request body, with only the parts a test varies exposed as parameters. */
    protected static String bookingBody(UUID serviceId, Instant startsAt, UUID staffId,
                                        String email) {
        return """
                {"serviceId": "%s", %s "startsAt": "%s",
                 "guestName": "Alex Guest", "guestEmail": "%s", "guestPhone": "+33 1 23 45 67 89",
                 "notes": "Second chair by the window, please"}
                """.formatted(serviceId,
                staffId == null ? "" : "\"staffId\": \"" + staffId + "\",",
                startsAt, email);
    }

    protected ResultActions book(Salon salon, Instant startsAt) throws Exception {
        return book(salon, startsAt, null, "alex@example.test");
    }

    protected ResultActions book(Salon salon, Instant startsAt, UUID staffId, String email)
            throws Exception {
        return mockMvc.perform(bookRequest(salon, startsAt, staffId, email));
    }

    protected MockHttpServletRequestBuilder bookRequest(Salon salon, Instant startsAt, UUID staffId,
                                                        String email) {
        return bookRequest(salon.slug(), salon.serviceId(), startsAt, staffId, email);
    }

    protected static MockHttpServletRequestBuilder bookRequest(String slug, UUID serviceId,
                                                               Instant startsAt, UUID staffId,
                                                               String email) {
        return post(bookingsPath(slug))
                .contentType(MediaType.APPLICATION_JSON)
                .content(bookingBody(serviceId, startsAt, staffId, email));
    }

    /**
     * Books and deserialises, for the tests that need the token or the chosen staff member rather
     * than a {@code jsonPath} assertion. Reading the response back through the same record the
     * controller returns is what keeps a test from asserting on a field name that no longer exists.
     */
    protected PublicBookingResponse bookOk(Salon salon, Instant startsAt) throws Exception {
        return bookOk(salon, startsAt, null, "alex@example.test");
    }

    protected PublicBookingResponse bookOk(Salon salon, Instant startsAt, UUID staffId,
                                           String email) throws Exception {
        String body = book(salon, startsAt, staffId, email)
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json.readValue(body, PublicBookingResponse.class);
    }

    /** The availability endpoint, so a test can assert what the booking did to the calendar. */
    protected MockHttpServletRequestBuilder availabilityRequest(Salon salon, LocalDate day) {
        return get("/api/public/businesses/{slug}/availability", salon.slug())
                .param("serviceId", salon.serviceId().toString())
                .param("from", day.toString())
                .param("to", day.toString());
    }

    protected static Instant parisTime(String localDateTime) {
        return LocalDateTime.parse(localDateTime).atZone(PARIS).toInstant();
    }
}
