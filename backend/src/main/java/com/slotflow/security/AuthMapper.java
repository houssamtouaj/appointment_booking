package com.slotflow.security;

import com.slotflow.business.Business;
import com.slotflow.common.mapping.MapperConfig;
import com.slotflow.staff.User;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

/**
 * Entity to DTO for the auth responses, and the first real consumer of the shared
 * {@link MapperConfig}.
 *
 * <p>The reason to generate this rather than hand-write two constructors is
 * {@code unmappedTargetPolicy = ERROR}: adding a field to {@link MeResponse} or
 * {@link BusinessSummary} and forgetting to populate it fails the build instead of returning
 * {@code null} to the SPA, which is where that class of bug is normally found — in a React form
 * that renders an empty input.
 */
@Mapper(config = MapperConfig.class)
public interface AuthMapper {

    BusinessSummary toSummary(Business business);

    /**
     * Two source parameters, so {@code id} has to be qualified: both {@link User} and
     * {@link BusinessSummary} have one, and MapStruct refuses to guess — correctly, since guessing
     * wrong here would put a business id where a user id belongs.
     */
    @Mapping(target = "id", source = "user.id")
    MeResponse toMe(User user, BusinessSummary business);

    /** The overload every caller actually has to hand. */
    default MeResponse toMe(User user, Business business) {
        return toMe(user, toSummary(business));
    }
}
