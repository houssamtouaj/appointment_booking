package com.slotflow.config;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.support.ApiIntegrationTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The OpenAPI document, which is a deliverable rather than a side effect: it is what the React
 * client is written against, and what the wave exit demos are driven from.
 *
 * <p>Worth a test because it fails in a way nothing else notices. Every endpoint can work perfectly
 * while the document 500s on one bad annotation — and the first person to find out is whoever opens
 * Swagger UI to demonstrate the thing.
 */
class OpenApiDocumentIT extends ApiIntegrationTest {

    @Test
    @DisplayName("the document generates, and is readable without a token")
    void theDocumentIsPublicAndValid() throws Exception {
        mockMvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.openapi").exists())
                .andExpect(jsonPath("$.info.title").value("SlotFlow API"))
                // Declared once in OpenApiConfig and referenced by every protected operation.
                .andExpect(jsonPath("$.components.securitySchemes.bearerAuth.scheme")
                        .value("bearer"));
    }

    @Test
    @DisplayName("every endpoint of this wave is in it")
    void theWaveThreeEndpointsAreDocumented() throws Exception {
        mockMvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.paths['/api/auth/register'].post").exists())
                .andExpect(jsonPath("$.paths['/api/auth/login'].post").exists())
                .andExpect(jsonPath("$.paths['/api/auth/refresh'].post").exists())
                .andExpect(jsonPath("$.paths['/api/auth/logout'].post").exists())
                .andExpect(jsonPath("$.paths['/api/auth/me'].get").exists())
                .andExpect(jsonPath("$.paths['/api/auth/forgot-password'].post").exists())
                .andExpect(jsonPath("$.paths['/api/auth/reset-password'].post").exists())
                .andExpect(jsonPath("$.paths['/api/staff'].get").exists())
                .andExpect(jsonPath("$.paths['/api/staff/invite'].post").exists())
                .andExpect(jsonPath("$.paths['/api/staff/{id}'].patch").exists())
                .andExpect(jsonPath("$.paths['/api/staff/{id}/invite/resend'].post").exists())
                .andExpect(jsonPath("$.paths['/api/public/invitations/{token}'].get").exists())
                .andExpect(jsonPath("$.paths['/api/public/invitations/{token}/accept'].post")
                        .exists())
                .andExpect(jsonPath("$.paths['/api/public/businesses/{slug}/staff'].get").exists());
    }

    @Test
    @DisplayName("every endpoint of wave four is in it")
    void theWaveFourEndpointsAreDocumented() throws Exception {
        mockMvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.paths['/api/services'].get").exists())
                .andExpect(jsonPath("$.paths['/api/services'].post").exists())
                .andExpect(jsonPath("$.paths['/api/services/{id}'].get").exists())
                .andExpect(jsonPath("$.paths['/api/services/{id}'].patch").exists())
                .andExpect(jsonPath("$.paths['/api/services/{id}'].delete").exists())
                .andExpect(jsonPath("$.paths['/api/public/businesses/{slug}'].get").exists())
                .andExpect(jsonPath("$.paths['/api/public/businesses/{slug}/services'].get")
                        .exists());
    }

    @Test
    @DisplayName("public operations do not ask the reader for a bearer token")
    void publicOperationsOptOutOfTheGlobalSecurityRequirement() throws Exception {
        // OpenApiConfig applies bearerAuth to the whole document, which is right for a mostly
        // authenticated API — but it means Swagger UI shows a padlock on sign-up and on the booking
        // endpoints unless they opt out explicitly. A padlock on /register is a small thing that
        // makes the demo confusing at exactly the wrong moment.
        mockMvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.paths['/api/auth/register'].post.security").isEmpty())
                .andExpect(jsonPath("$.paths['/api/public/businesses/{slug}/staff'].get.security")
                        .isEmpty())
                .andExpect(jsonPath("$.paths['/api/public/businesses/{slug}'].get.security")
                        .isEmpty())
                .andExpect(jsonPath("$.paths['/api/public/businesses/{slug}/services'].get.security")
                        .isEmpty())
                // logout is public too, and the padlock has to agree: a client whose access token
                // expired still has to be able to revoke its refresh cookie.
                .andExpect(jsonPath("$.paths['/api/auth/logout'].post.security").isEmpty())
                // While an authenticated one keeps it.
                .andExpect(jsonPath("$.paths['/api/staff'].get.security").doesNotExist());
    }
}
