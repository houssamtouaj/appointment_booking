package com.slotflow.common.jpa;

import jakarta.persistence.Column;
import jakarta.persistence.EntityListeners;
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
 * Everything a row in this schema has apart from its primary key: a creation timestamp, an honest
 * answer to "is this new?", and an identity that survives being loaded twice.
 *
 * <h2>Why the id is not here</h2>
 * Almost every entity has a surrogate {@code id} column and gets it from {@link AbstractEntity}.
 * {@code BookingPolicy} does not — its primary key <em>is</em> its {@code business_id} foreign key,
 * which is what makes a second policy for a business unrepresentable — and inheriting an id would
 * map a column that does not exist. Splitting the id off leaves one copy of the
 * {@link Persistable} contract serving both shapes; the alternative, which this class replaced, was
 * two copies that had to be kept in step by hand.
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
public abstract class AbstractAuditedEntity implements Persistable<UUID> {

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
     *
     * <p>The other side is read through {@link #getId()} and never through its field. A proxy is a
     * generated subclass whose inherited fields are never populated — the state lives in the
     * initialiser behind it — so a field read returns null and hands back {@code false} for an
     * entity compared with its own proxy, which is the exact case the line above exists to handle.
     */
    @Override
    public final boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (other == null || Hibernate.getClass(this) != Hibernate.getClass(other)) {
            return false;
        }
        return getId().equals(((AbstractAuditedEntity) other).getId());
    }

    @Override
    public final int hashCode() {
        return getId().hashCode();
    }

    @Override
    public String toString() {
        return Hibernate.getClass(this).getSimpleName() + "(" + getId() + ")";
    }
}
