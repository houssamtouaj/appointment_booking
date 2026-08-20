package com.slotflow.common.jpa;

import jakarta.persistence.Id;
import jakarta.persistence.MappedSuperclass;
import java.util.UUID;

/**
 * What every row with a surrogate key has: a UUID primary key assigned in Java, on top of the
 * auditing and identity that {@link AbstractAuditedEntity} already provides.
 *
 * <h2>Why the id is generated here and not by the database</h2>
 * A service can assemble a whole aggregate — a business, its policy, its owner — and wire the
 * foreign keys between them before anything is flushed. With a database-generated id every
 * child would need its parent inserted first, which turns one readable method into a sequence
 * of {@code saveAndFlush} calls. See {@link AbstractAuditedEntity} for what that costs and how
 * {@link org.springframework.data.domain.Persistable} pays it back.
 */
@MappedSuperclass
public abstract class AbstractEntity extends AbstractAuditedEntity {

    @Id
    private UUID id = UUID.randomUUID();

    @Override
    public UUID getId() {
        return id;
    }
}
