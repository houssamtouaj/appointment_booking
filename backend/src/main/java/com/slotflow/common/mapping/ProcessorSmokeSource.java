package com.slotflow.common.mapping;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * Lombok-generated accessors only. If Lombok has not run by the time MapStruct inspects this
 * type, MapStruct sees a property-less class and silently generates a mapper that sets
 * nothing. See {@code ProcessorSmokeMapper}.
 */
@Getter
@AllArgsConstructor
public class ProcessorSmokeSource {

    private final String name;
    private final int durationMinutes;
}
