package com.slotflow.common.mapping;

import org.mapstruct.Mapper;

/**
 * Build-configuration canary, not domain code.
 *
 * <p>MapStruct and Lombok are both annotation processors, and if MapStruct runs first it maps
 * Lombok types to all-nulls without a single warning. That failure is invisible until a DTO
 * comes back empty in plan 07, which is an expensive place to find it. This mapper plus
 * {@code ProcessorSmokeMapperTest} turn it into a red unit test instead.
 *
 * <p>Delete both once real mappers with real assertions exist.
 */
@Mapper
public interface ProcessorSmokeMapper {

    ProcessorSmokeTarget toTarget(ProcessorSmokeSource source);
}
