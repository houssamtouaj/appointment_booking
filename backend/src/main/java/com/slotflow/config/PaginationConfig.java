package com.slotflow.config;

import com.slotflow.common.web.PageResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.web.config.PageableHandlerMethodArgumentResolverCustomizer;

/**
 * The server side of {@code ?page=&size=}.
 *
 * <p>Two caps, both of which exist because the client controls the numbers:
 * <ul>
 *   <li><b>size 20 by default</b>, so an endpoint called without parameters returns a page and
 *       not a table;</li>
 *   <li><b>size 100 maximum</b>, silently clamped rather than rejected. {@code ?size=100000} on
 *       the bookings endpoint is otherwise a one-line denial of service against a table that
 *       grows forever, and a 422 there teaches a client nothing useful.</li>
 * </ul>
 *
 * <p>Responses are always wrapped in {@link PageResponse}; a Spring {@code Page} never reaches
 * a controller signature.
 */
@Configuration
public class PaginationConfig {

    /** Above this, a caller wants an export, which is a different endpoint with a different cost. */
    public static final int MAX_PAGE_SIZE = 100;

    public static final int DEFAULT_PAGE_SIZE = 20;

    /**
     * Customises the resolver rather than setting {@code spring.data.web.pageable.*}: it is the
     * same mechanism Boot's own properties use, and having it here keeps the two constants above
     * importable by the tests that assert on them.
     */
    @Bean
    public PageableHandlerMethodArgumentResolverCustomizer pageableCustomizer() {
        return resolver -> {
            resolver.setMaxPageSize(MAX_PAGE_SIZE);
            resolver.setFallbackPageable(PageRequest.of(0, DEFAULT_PAGE_SIZE));
            // Zero-based, matching PageResponse.page and Spring Data's own convention. Flipping
            // this on would make the wire disagree with every repository call underneath it.
            resolver.setOneIndexedParameters(false);
        };
    }
}
