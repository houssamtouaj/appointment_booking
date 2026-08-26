package com.slotflow.demo;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.support.ApiIntegrationTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The other half of the demo endpoint: what a deployment that is <em>not</em> the demo answers.
 *
 * <p>Deliberately not a subclass of {@link DemoProfileTest} — this one runs in the ordinary
 * application context, with the ordinary profiles, which is the whole point and also why it costs
 * nothing: it shares the context every other integration test already paid for.
 *
 * <p>{@code POST /api/auth/demo-login} hands out a session for a real tenant with no credential
 * presented. Two independent things stop that here: the controller is {@code @Profile("demo")} and
 * does not exist, and the path is absent from the security allowlist. The second is what this test
 * pins, because it is the one that keeps holding if somebody drops the annotation — a 401 from the
 * filter chain rather than a 404 from the dispatcher is how you can tell which gate answered.
 */
class DemoLoginDisabledIT extends ApiIntegrationTest {

    @Test
    @DisplayName("without the demo profile the path is refused by the filter chain, not merely absent")
    void thereIsNoOneClickSignInInAnOrdinaryDeployment() throws Exception {
        // Spelt out rather than imported from SecurityConfig, where it is private on purpose: a test
        // that shared the constant would keep passing if the path were renamed, and the SPA calling
        // the old one would not.
        mockMvc.perform(post("/api/auth/demo-login"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
    }
}
