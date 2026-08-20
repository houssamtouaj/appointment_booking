package com.slotflow.config;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * The one bean that makes time testable.
 *
 * <p>This is the only place in {@code src/main/java} where the current time is obtained from
 * the system. Everything else injects this {@code Clock} and calls {@code clock.instant()},
 * which is why a direct call to {@code Instant.now()} or {@code LocalDate.now()} anywhere else
 * is a review blocker rather than a style preference:
 *
 * <pre>{@code grep -rn "Instant.now()" backend/src/main/java   # only ever this file}</pre>
 *
 * <p>The payoff arrives in plan 09. The availability engine has to be tested against a DST
 * transition, a lead time of 24 hours, and a maximum advance of 60 days. Every one of those
 * tests is a one-liner with {@code Clock.fixed(...)} and impossible without it, because the
 * alternative is a suite whose result depends on the date it runs on.
 *
 * <p>UTC rather than the system zone on purpose: the wire and the database are both UTC, and a
 * clock that follows the host's zone would make behaviour differ between a developer's laptop
 * and the deployed container.
 */
@Configuration
public class ClockConfig {

    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }
}
