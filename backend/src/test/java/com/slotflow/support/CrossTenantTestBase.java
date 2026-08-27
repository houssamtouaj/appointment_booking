package com.slotflow.support;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

/**
 * The reusable half of "no request can reach another tenant's data".
 *
 * <p>Plan 06 builds the tenant guard and plans 07–13 all depend on it, which means every admin
 * endpoint they add needs the same two assertions. Writing that harness once, here, is what makes
 * "every admin endpoint has a cross-tenant test" affordable rather than aspirational: a subclass
 * lists its endpoints and inherits the assertions.
 *
 * <h2>What a subclass declares</h2>
 * A {@link CrossTenantCase} per endpoint, with <b>two</b> paths — the one reaching into
 * {@link #theirs} and the equivalent one inside {@link #mine}. The second is not decoration. A
 * cross-tenant read test asserts a 404, and a mistyped path returns 404 for everyone: without the
 * paired positive call, a subclass with a typo in its URL passes forever while testing nothing at
 * all. This is the failure mode that makes security tests worse than no tests, because they are
 * believed.
 *
 * <h2>Why the two verdicts differ</h2>
 * Reads answer {@code 404}: a foreign id must be indistinguishable from a nonexistent one, or the
 * endpoint becomes an existence oracle. Writes answer {@code 403}: the caller is authenticated and
 * being refused, and a write attempt is not a survey. Both come from
 * {@link com.slotflow.tenant.TenantContext}.
 */
public abstract class CrossTenantTestBase extends ApiIntegrationTest {

    /** Business A. Every request in this class is made with its owner's token. */
    protected Tenant mine;

    /** Business B. Its ids are the ones the requests reach for. */
    protected Tenant theirs;

    @BeforeEach
    void createBothTenants() {
        mine = aTenant();
        theirs = aTenant();
    }

    /**
     * One endpoint under test.
     *
     * @param foreignPath the path naming a resource of {@link #theirs}
     * @param ownPath     the same endpoint naming an equivalent resource of {@link #mine}, which
     *                    must succeed — the control that keeps the negative assertion honest
     * @param body        JSON for a write, null for a read
     */
    protected record CrossTenantCase(HttpMethod method, String foreignPath, String ownPath,
            String body) {

        public static CrossTenantCase read(String foreignPath, String ownPath) {
            return new CrossTenantCase(HttpMethod.GET, foreignPath, ownPath, null);
        }

        public static CrossTenantCase write(HttpMethod method, String foreignPath, String ownPath,
                String body) {
            return new CrossTenantCase(method, foreignPath, ownPath, body);
        }

        boolean isRead() {
            return HttpMethod.GET.equals(method);
        }

        @Override
        public String toString() {
            return method + " " + foreignPath;
        }
    }

    /** Called after the tenants exist, so a subclass may use their ids. */
    protected abstract List<CrossTenantCase> crossTenantCases();

    @TestFactory
    Stream<DynamicTest> readsAreNotFoundAndWritesAreForbidden() {
        List<CrossTenantCase> cases = crossTenantCases();
        assertThat(cases).as("a subclass with no cases asserts nothing").isNotEmpty();

        return cases.stream().flatMap(testCase -> Stream.of(
                DynamicTest.dynamicTest("refused: " + testCase, () -> assertRefused(testCase)),
                DynamicTest.dynamicTest("reachable in my own tenant: " + testCase,
                        () -> assertReachable(testCase))));
    }

    private void assertRefused(CrossTenantCase testCase) throws Exception {
        ResultActions result = perform(testCase.method(), testCase.foreignPath(), testCase.body());
        if (testCase.isRead()) {
            result.andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.code").value("NOT_FOUND"));
        } else {
            result.andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
        }
    }

    /**
     * The control. Any 2xx will do — this is not a test of what the endpoint returns, only that the
     * path, method and body are right, so that the refusal above is a refusal and not a typo.
     */
    private void assertReachable(CrossTenantCase testCase) throws Exception {
        perform(testCase.method(), testCase.ownPath(), testCase.body())
                .andExpect(status().is2xxSuccessful());
    }

    private ResultActions perform(HttpMethod method, String path, String body) throws Exception {
        MockHttpServletRequestBuilder request = MockMvcRequestBuilders.request(method, path)
                .header(HttpHeaders.AUTHORIZATION, bearer(mine.owner()));
        if (body != null) {
            request.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return mockMvc.perform(request);
    }
}
