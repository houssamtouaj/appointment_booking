package com.slotflow.common.mapping;

import org.mapstruct.InjectionStrategy;
import org.mapstruct.NullValuePropertyMappingStrategy;
import org.mapstruct.ReportingPolicy;

/**
 * The shared MapStruct configuration every mapper from plan 05 onwards references with
 * {@code @Mapper(config = MapperConfig.class)}.
 *
 * <p>One place for these four choices, so a new mapper cannot quietly opt out of them:
 *
 * <ul>
 *   <li><b>unmapped targets are an error.</b> The default is a warning, and a warning in a
 *       thousand-line build log is the same as silence. A DTO field nobody wired up returns
 *       {@code null} to the client, which surfaces as an empty input in the React form and gets
 *       diagnosed as a frontend bug.</li>
 *   <li><b>unmapped sources are ignored.</b> Entities legitimately carry fields no DTO shows,
 *       {@code passwordHash} first among them.</li>
 *   <li><b>null source properties leave the target alone</b>, which is what a PATCH means. Plan
 *       07 depends on this for partial service updates.</li>
 *   <li><b>constructor injection</b>, so a generated mapper that depends on another one is still
 *       final-field and immutable.</li>
 * </ul>
 *
 * <p>The annotation is fully qualified because the type is deliberately named after what it is;
 * importing {@code org.mapstruct.MapperConfig} would collide with the interface it annotates.
 */
@org.mapstruct.MapperConfig(
        componentModel = "spring",
        unmappedTargetPolicy = ReportingPolicy.ERROR,
        unmappedSourcePolicy = ReportingPolicy.IGNORE,
        nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE,
        injectionStrategy = InjectionStrategy.CONSTRUCTOR)
public interface MapperConfig {}
