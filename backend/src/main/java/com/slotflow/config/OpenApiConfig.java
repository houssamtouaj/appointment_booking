package com.slotflow.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import io.swagger.v3.oas.models.servers.Server;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Swagger UI is the API contract the React client is written against, so the document is
 * configured explicitly rather than left to defaults.
 */
@Configuration
public class OpenApiConfig {

    /** Referenced by name from {@code @SecurityRequirement} on protected controllers. */
    public static final String BEARER_SCHEME = "bearerAuth";

    private final String title;
    private final String version;
    private final List<String> serverUrls;

    public OpenApiConfig(
            @Value("${app.openapi.title}") String title,
            @Value("${app.openapi.version}") String version,
            @Value("${app.openapi.server-urls}") List<String> serverUrls) {
        this.title = title;
        this.version = version;
        this.serverUrls = serverUrls;
    }

    @Bean
    public OpenAPI slotflowOpenApi() {
        return new OpenAPI()
                .info(new Info()
                        .title(title)
                        .version(version)
                        .description("""
                                Multi-tenant appointment and booking API.

                                Conventions that hold for every endpoint:
                                * every instant on the wire is UTC ISO-8601
                                * errors are RFC 7807 problem details
                                * admin requests are scoped to the business in the access token,
                                  never to a path or query parameter
                                * overlapping bookings are rejected by a database exclusion
                                  constraint that accounts for buffers, and surface as 409
                                """)
                        .contact(new Contact().name("SlotFlow"))
                        .license(new License().name("MIT")))
                .servers(serverUrls.stream().map(url -> new Server().url(url)).toList())
                .components(new Components().addSecuritySchemes(BEARER_SCHEME,
                        new SecurityScheme()
                                .type(SecurityScheme.Type.HTTP)
                                .scheme("bearer")
                                .bearerFormat("JWT")
                                .description("Access token from POST /api/auth/login")))
                .addSecurityItem(new SecurityRequirement().addList(BEARER_SCHEME));
    }
}
