package com.slotflow.availability;

import com.slotflow.common.mapping.MapperConfig;
import org.mapstruct.Mapper;

/**
 * {@link AvailabilityOverride} to the shape the admin calendar reads.
 *
 * <p>Every target maps by name, {@code businessWide} and {@code wholeDay} included: they are
 * {@code isBusinessWide()} and {@code isWholeDay()} on the entity, which are JavaBean accessors as
 * far as MapStruct is concerned. That is the argument for keeping those two as methods on the entity
 * rather than as expressions here — the definition of "business-wide" stays next to the field it
 * reads, and the engine (plan 09) asks the entity the same question.
 */
@Mapper(config = MapperConfig.class)
public interface AvailabilityMapper {

    OverrideResponse toResponse(AvailabilityOverride override);
}
