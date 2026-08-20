package com.slotflow.config;

import java.time.Clock;
import java.time.temporal.TemporalAccessor;
import java.util.Optional;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.auditing.DateTimeProvider;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;

/**
 * Wires {@code @CreatedDate} and {@code @LastModifiedDate} to the application {@code Clock}
 * rather than to the system clock.
 *
 * <p>This is the reason plan 04 had to land before plan 03. Spring Data's default provider calls
 * the system clock directly, which would make {@code created_at} the one value a test cannot
 * pin — and "a PENDING booking older than 30 minutes is cancelled by the sweeper" is a test that
 * has to move time to be worth writing at all. One bean, and the whole schema's audit columns
 * become as controllable as the rest of the domain.
 */
@Configuration
@EnableJpaAuditing(dateTimeProviderRef = "auditingDateTimeProvider")
public class JpaAuditingConfig {

    @Bean
    public DateTimeProvider auditingDateTimeProvider(Clock clock) {
        return () -> Optional.<TemporalAccessor>of(clock.instant());
    }
}
