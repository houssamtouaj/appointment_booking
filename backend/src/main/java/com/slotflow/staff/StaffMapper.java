package com.slotflow.staff;

import com.slotflow.common.mapping.MapperConfig;
import java.util.List;
import java.util.UUID;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

/**
 * {@link User} to the two DTOs the staff endpoints return.
 *
 * <p>Both mappings are explicit about {@code passwordHash}, in the sense that neither target has a
 * field for it and {@code unmappedSourcePolicy = IGNORE} lets that pass. The protection is not the
 * mapper, it is the DTOs: a record with five components cannot leak a sixth.
 */
@Mapper(config = MapperConfig.class)
public interface StaffMapper {

    /**
     * @param invitationPending whether an unaccepted invitation exists, which the entity cannot
     *                          answer on its own — it lives in {@code staff_invitation}
     * @param serviceIds        passed in because the assignment is a separate table, read in one
     *                          query for the whole page rather than per row
     */
    StaffResponse toResponse(User user, boolean invitationPending, List<UUID> serviceIds);

    /** D9. {@code fullName} becomes {@code displayName}: what it means to a customer. */
    @Mapping(target = "displayName", source = "fullName")
    PublicStaffResponse toPublicResponse(User user);
}
