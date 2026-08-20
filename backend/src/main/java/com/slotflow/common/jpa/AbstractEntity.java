package com.slotflow.common.jpa;

import jakarta.persistence.Column;
import jakarta.persistence.EntityListeners;
import jakarta.persistence.Id;
import jakarta.persistence.MappedSuperclass;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Transient;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.Hibernate;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.domain.Persistable;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

/**
 * What every row in this schema has: a UUID primary key assigned in Java, a creation
 * timestamp, and an identity that survives being loaded twice.
 *
 * <h2>Why the id is generated here and not by the database</h2>
 * A service can assemble a whole aggregate — a business, its policy, its owner — and wire the
 * foreign keys between them before anything is flushed. With a database-generated id every
 * child would need its parent inserted first, which turns one readable method into a sequence
 * of {@code saveAndFlush} calls.
 *
 * <h2>Why {@link Persistable} is implemented</h2>
 * This is the trap that comes with assigning ids yourself. {@code SimpleJpaRepository.save()}
 * decides between {@code persist} and {@code merge} by asking whether the id is null; with an
 * assigned id it is never null, so every {@code save} of a brand new row becomes a
 * {@code merge} — a wasted {@code SELECT} before every {@code INSERT}, and a returned instance
 * that is not the one that was passed in. The transient flag below answers "is this new?"
 * honestly instead, and is set by the JPA callbacks the moment a row is persisted or loaded.
 */
@MappedSuperclass
@EntityListeners(AuditingEntityListener.class)
public abstract class AbstractEntity implements Persistable<UUID> {

    @Id
    private UUID id = UUID.randomUUID();

    /**
     * Written by Spring Data auditing from the injected {@code Clock}, so a test that pins time
     * gets rows stamped with the pinned time. {@code updatable = false} means no later write can
     * rewrite history, whatever the caller intended.
     */
    @CreatedDate
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    /**
     * Not a column. False on a freshly constructed instance, true as soon as the row exists or
     * has been read back — which is exactly what {@link #isNew()} needs to know.
     */
    @Transient
    private boolean persisted;

    @Override
    public UUID getId() {
        return id;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    @Override
    public boolean isNew() {
        return !persisted;
    }

    @PostPersist
    @PostLoad
    void markPersisted() {
        this.persisted = true;
    }

    /**
     * Identity is the id, because the id exists before the row does — the whole point of
     * assigning it in Java. {@code Hibernate.getClass} rather than {@code getClass}: a lazy
     * proxy is a generated subclass, and comparing raw classes would make an entity unequal to
     * its own proxy.
     */
    @Override
    public final boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (other == null || Hibernate.getClass(this) != Hibernate.getClass(other)) {
            return false;
        }
        return id.equals(((AbstractEntity) other).id);
    }

    @Override
    public final int hashCode() {
        return id.hashCode();
    }

    @Override
    public String toString() {
        return Hibernate.getClass(this).getSimpleName() + "(" + id + ")";
    }
}
