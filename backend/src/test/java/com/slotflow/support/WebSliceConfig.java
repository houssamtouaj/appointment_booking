package com.slotflow.support;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.slotflow.common.error.ProblemDetailWriter;
import com.slotflow.common.web.RateLimitProperties;
import com.slotflow.common.web.RateLimiter;
import java.time.Duration;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;

/**
 * The wiring a {@code @WebMvcTest} slice needs before it can assert on anything.
 *
 * <p>Two problems, both structural rather than incidental:
 *
 * <ul>
 *   <li>A slice test does not load {@code @Configuration} classes, so Boot's default security
 *       chain applies and every request comes back 401. The chain here removes that noise; the
 *       real one is plan 05's subject, and plan 05's tests assert on it directly.</li>
 *   <li>A slice test <em>does</em> register {@code Filter} beans, so
 *       {@code RateLimitFilter} is present and needs its collaborators. They are provided here
 *       with limiting switched off: a shared bucket across a test class makes the outcome of one
 *       test depend on how many requests the previous one made.</li>
 * </ul>
 */
@TestConfiguration
public class WebSliceConfig {

    @Bean
    SecurityFilterChain permitEverything(HttpSecurity http) throws Exception {
        return http
                .csrf(csrf -> csrf.disable())
                .authorizeHttpRequests(auth -> auth.anyRequest().permitAll())
                .build();
    }

    @Bean
    ProblemDetailWriter problemDetailWriter(ObjectMapper objectMapper) {
        return new ProblemDetailWriter(objectMapper);
    }

    /**
     * The budgets are supplied and never consulted: {@code enabled: false} short-circuits before
     * any bucket exists. They are not null because {@link RateLimitProperties} refuses a missing
     * limit rather than inventing one — the numbers live in {@code application.yml} alone.
     */
    @Bean
    RateLimiter rateLimiter() {
        RateLimitProperties.Limit unused = new RateLimitProperties.Limit(1, Duration.ofMinutes(1));
        return new RateLimiter(new RateLimitProperties(false, unused, unused, unused));
    }
}
