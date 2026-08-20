package com.slotflow.common.jpa;

import jakarta.persistence.Column;
import jakarta.persistence.MappedSuperclass;
import java.time.Instant;
import org.springframework.data.annotation.LastModifiedDate;

/**
 * For rows that get edited, which is the majority of them.
 *
 * <p>The split from {@link AbstractEntity} follows the schema rather than taste: the token
 * tables are insert-only and have no {@code updated_at} column, so giving them a
 * {@code @LastModifiedDate} field would fail {@code ddl-auto: validate} on startup. A revoked
 * refresh token records the revocation in {@code revoked_at}, which is data, not metadata.
 */
@MappedSuperclass
public abstract class AbstractMutableEntity extends AbstractEntity {

    @LastModifiedDate
    @Column(nullable = false)
    private Instant updatedAt;

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
