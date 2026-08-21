package com.slotflow.catalog;

import com.slotflow.common.mapping.MapperConfig;
import java.util.List;
import java.util.UUID;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

/**
 * {@link ServiceOffering} to the two DTOs the catalog endpoints return.
 *
 * <p>{@code totalBlockMinutes} is an expression because it is a method on the entity rather than a
 * JavaBean accessor MapStruct would find on its own — and it stays a method on the entity because
 * the buffer arithmetic has exactly one definition (D4), which the engine and the booking insert
 * also go through.
 *
 * <p>{@code bookable} and {@code staffIds} arrive as parameters: both are facts about
 * {@code staff_service} and {@code app_user}, read once for a whole page rather than per row.
 */
@Mapper(config = MapperConfig.class)
public interface CatalogMapper {

    @Mapping(target = "totalBlockMinutes", expression = "java(service.totalBlockMinutes())")
    ServiceResponse toResponse(ServiceOffering service, boolean bookable, List<UUID> staffIds);

    /** The customer's view: no buffers, no flags. See {@link PublicServiceResponse}. */
    PublicServiceResponse toPublicResponse(ServiceOffering service);
}
