package com.slotflow.common.mapping;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Guards the annotation-processor order configured in pom.xml.
 *
 * <p>When MapStruct runs before Lombok it sees types with no accessors and generates a mapper
 * that compiles, runs, and returns an object with every field null — no warning anywhere. This
 * test is the cheap early warning: it goes red on the build configuration, not three plans
 * later on a mysteriously empty API response.
 *
 * <p>The generated implementation is constructed directly rather than looked up through
 * {@code Mappers.getMapper()}. The lookup is reflective, and under {@code componentModel =
 * "spring"} it only happens to work while this mapper has no collaborators to inject: give it a
 * nested mapper and it fails with a reflection error instead of an assertion, which would quietly
 * cost the ordering guard this class exists to provide. Naming the impl makes the same check a
 * compile-time one — if the processor did not run, this file does not build.
 */
class ProcessorSmokeMapperTest {

    @Test
    @DisplayName("MapStruct maps Lombok-generated properties, so Lombok ran first")
    void mapsLombokProperties() {
        ProcessorSmokeMapper mapper = new ProcessorSmokeMapperImpl();

        ProcessorSmokeTarget target = mapper.toTarget(new ProcessorSmokeSource("Deep tissue", 60));

        assertThat(target).isNotNull();
        assertThat(target.getName())
                .as("null here means MapStruct saw no getters — check annotationProcessorPaths order")
                .isEqualTo("Deep tissue");
        assertThat(target.getDurationMinutes()).isEqualTo(60);
    }
}
