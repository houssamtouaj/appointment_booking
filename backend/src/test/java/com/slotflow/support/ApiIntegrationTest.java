package com.slotflow.support;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.slotflow.business.BookingPolicy;
import com.slotflow.business.BookingPolicyRepository;
import com.slotflow.business.Business;
import com.slotflow.business.BusinessRepository;
import com.slotflow.notification.NotificationService;
import com.slotflow.security.JwtService;
import com.slotflow.staff.User;
import com.slotflow.staff.UserRepository;
import com.slotflow.support.fixtures.Fixtures;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpHeaders;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * Base class for a test that drives the API through {@link MockMvc}, with the real security filter
 * chain in front of it.
 *
 * <p>It adds three things to {@link IntegrationTest} and nothing else, so that every subclass keeps
 * sharing one application context:
 *
 * <ul>
 *   <li><b>MockMvc with the security chain applied</b>, which is the point: an authorisation test
 *       that bypasses the filter chain proves nothing about the filter chain.</li>
 *   <li><b>Rate limiting off.</b> The buckets are per process and keyed by IP, so with it on the
 *       eleventh login in a class would fail — and which test that is would depend on execution
 *       order. {@code RateLimitFilterTest} covers the limiter itself, where the assertions can be
 *       exact.</li>
 *   <li><b>A recording notification service</b>, so a test can read an invitation link the way its
 *       recipient would. See {@link RecordingNotificationService}.</li>
 * </ul>
 *
 * <p>The tenant helpers below matter more than they look. Container reuse means the database is not
 * empty between runs, so every test builds its own business and asserts only on rows it created —
 * {@code aBusiness()} generates a unique slug and each user a unique email for exactly that reason.
 */
@AutoConfigureMockMvc
@TestPropertySource(properties = "app.rate-limit.enabled=false")
@ContextConfiguration(classes = ApiIntegrationTest.RecordingNotifications.class)
public abstract class ApiIntegrationTest extends IntegrationTest {

    /**
     * The password every fixture user has. A constant, because a test asserting on a login failure
     * needs to be able to say "and this is the password that would have worked".
     */
    protected static final String PASSWORD = "correct-horse-battery";

    @Autowired
    protected MockMvc mockMvc;

    @Autowired
    protected ObjectMapper json;

    @Autowired
    protected RecordingNotificationService notifications;

    @Autowired
    protected JwtService jwtService;

    @Autowired
    protected PasswordEncoder passwordEncoder;

    @Autowired
    protected BusinessRepository businesses;

    @Autowired
    protected BookingPolicyRepository policies;

    @Autowired
    protected UserRepository users;

    @BeforeEach
    void emptyTheInbox() {
        notifications.clear();
    }

    // ---------------------------------------------------------------------------------
    //  tenants
    // ---------------------------------------------------------------------------------

    /** A business, its policy and its owner — what {@code POST /api/auth/register} would create. */
    protected record Tenant(Business business, User owner) {

        public UUID id() {
            return business.getId();
        }
    }

    protected Tenant aTenant() {
        Business business = businesses.save(Fixtures.aBusiness().build());
        policies.save(BookingPolicy.defaultsFor(business.getId()));
        User owner = users.save(Fixtures.anOwner()
                .forBusiness(business)
                .withPasswordHash(passwordEncoder.encode(PASSWORD))
                .build());
        return new Tenant(business, owner);
    }

    /** An accepted, active staff member of that tenant, able to log in with {@link #PASSWORD}. */
    protected User aStaffMemberOf(Tenant tenant) {
        return users.save(Fixtures.aStaffMember()
                .forBusiness(tenant.business())
                .withPasswordHash(passwordEncoder.encode(PASSWORD))
                .build());
    }

    /** A second owner, so a test can deactivate the first one without hitting {@code LAST_OWNER}. */
    protected User anotherOwnerOf(Tenant tenant) {
        return users.save(Fixtures.anOwner()
                .forBusiness(tenant.business())
                .withPasswordHash(passwordEncoder.encode(PASSWORD))
                .build());
    }

    // ---------------------------------------------------------------------------------
    //  request helpers
    // ---------------------------------------------------------------------------------

    /** The {@code Authorization} header value for a user, signed by the application's own service. */
    protected String bearer(User user) {
        return "Bearer " + jwtService.issue(user);
    }

    protected String asJson(Object body) {
        try {
            return json.writeValueAsString(body);
        } catch (Exception e) {
            throw new IllegalStateException("could not serialise " + body, e);
        }
    }

    /**
     * Reads the refresh token out of the {@code Set-Cookie} header.
     *
     * <p>Parsed by hand rather than through {@code response.getCookie(...)}: the cookie is written
     * as a header so that it can carry {@code SameSite}, which the servlet {@code Cookie} API cannot
     * express, and MockMvc's cookie accessors only see cookies added through that API.
     */
    protected String refreshCookieFrom(MvcResult result) {
        for (String header : result.getResponse().getHeaders(HttpHeaders.SET_COOKIE)) {
            if (header.startsWith(REFRESH_COOKIE_NAME + "=")) {
                String value = header.substring(REFRESH_COOKIE_NAME.length() + 1);
                int end = value.indexOf(';');
                String token = end < 0 ? value : value.substring(0, end);
                return token.isEmpty() ? null : token;
            }
        }
        throw new AssertionError("no " + REFRESH_COOKIE_NAME + " cookie on the response");
    }

    /**
     * Duplicated from {@code RefreshTokenCookie.NAME} on purpose. The name is part of the published
     * contract the SPA is written against, so a test that imported the constant would keep passing
     * if somebody renamed it — and every browser client would break.
     */
    protected static final String REFRESH_COOKIE_NAME = "slotflow_refresh";

    @TestConfiguration
    static class RecordingNotifications {

        /**
         * One bean, marked primary, and that is enough for both injection points: a test asks for
         * the concrete recorder, the application asks for the {@link NotificationService}
         * interface, and primary decides between this and the logging implementation. Declaring a
         * second primary bean for the interface would make the interface ambiguous instead.
         */
        @Bean
        @Primary
        RecordingNotificationService recordingNotificationService() {
            return new RecordingNotificationService();
        }
    }
}
