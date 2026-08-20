package com.slotflow.config;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * JSON conventions, in code rather than only in {@code application.yml}, because these four
 * decisions are part of the published contract and a property file is easy to override by
 * accident.
 *
 * <p>A {@code Jackson2ObjectMapperBuilderCustomizer} rather than a replacement
 * {@code ObjectMapper} bean: this composes with everything Boot already registers, notably the
 * {@code ProblemDetail} mixin that makes RFC 7807's extension members serialise flat instead of
 * nested under {@code properties}.
 */
@Configuration
public class JacksonConfig {

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer slotflowJacksonCustomizer() {
        return builder -> builder
                // ISO-8601 strings, never epoch numbers. "2026-03-02T09:00:00Z" survives being
                // read by a human in a log, a curl output and a Stripe dashboard; 1772442000 does
                // not, and the client has to know the unit to parse it at all.
                .featuresToDisable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS,
                        SerializationFeature.WRITE_DATE_TIMESTAMPS_AS_NANOSECONDS,
                        SerializationFeature.WRITE_DURATIONS_AS_TIMESTAMPS,
                        // An Instant is a fixed point on the timeline. Rewriting it into the
                        // JVM's zone on the way in is how a UTC-at-rest rule gets quietly broken.
                        DeserializationFeature.ADJUST_DATES_TO_CONTEXT_TIME_ZONE)
                // A misspelled field is a client bug, and returning 200 for it means the bug ships.
                // Failing loudly costs one 400 during development and saves a support thread about
                // a setting that "does not save".
                .featuresToEnable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                // Absent rather than null: an optional field the server has nothing to say about
                // should not appear at all. Keeps problem bodies free of empty members.
                .serializationInclusion(JsonInclude.Include.NON_NULL);
    }
}
