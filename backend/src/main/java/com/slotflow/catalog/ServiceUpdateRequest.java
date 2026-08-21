package com.slotflow.catalog;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

/**
 * {@code PATCH /api/services/{id}}: every field optional, and {@code null} means "leave it alone".
 *
 * <h2>{@code staffIds}: absent, null and empty</h2>
 * Plan 07 calls this the classic trap, and it is decided here rather than left to whoever reads the
 * mapper:
 *
 * <ul>
 *   <li><b>absent</b> — the assignment set is untouched. This is what a form that only edits the
 *       price sends;</li>
 *   <li><b>{@code null}</b> — the same as absent. Jackson cannot tell the two apart in a record
 *       component, and pretending otherwise means a {@code JsonNullable} wrapper on every optional
 *       field of every patch in the API to distinguish an intention no client has expressed;</li>
 *   <li><b>{@code []}</b> — unassign everyone. The service stays, and comes back as
 *       {@code bookable: false}.</li>
 * </ul>
 *
 * <p>{@code CatalogIT} tests the absent and the empty case, because a rule about JSON absence that
 * only exists in a javadoc is a rule that changes the first time somebody edits the mapper.
 *
 * <h2>The other fields</h2>
 * {@code description} is the one field an empty string is meaningful for: {@code ""} clears it,
 * because {@code null} is already spoken for. Buffers are one editorial decision on the entity —
 * sending one of the pair keeps the other as it is.
 *
 * <p>{@code active} exists so the admin UI can reactivate a soft-deleted service without a second
 * endpoint. {@code active: false} is exactly what {@code DELETE /api/services/{id}} does, which is
 * why the delete is a soft one: a service with bookings cannot be removed (the plan-02 foreign key
 * refuses it), and the ones without would still be losing their history for no reason.
 */
public record ServiceUpdateRequest(

        @Size(min = 2, max = 120) String name,

        @Size(max = 2000) String description,

        @ServiceDuration Integer durationMinutes,

        @Min(0) Long priceCents,

        @Min(0) @Max(120) Integer bufferBeforeMinutes,

        @Min(0) @Max(120) Integer bufferAfterMinutes,

        Boolean active,

        @Size(max = 100) List<@NotNull UUID> staffIds) {

    /** Whether this patch touches the pair the entity sets together. */
    boolean changesBuffers() {
        return bufferBeforeMinutes != null || bufferAfterMinutes != null;
    }
}
