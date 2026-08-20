package com.slotflow.catalog;

import com.slotflow.common.jpa.AbstractMutableEntity;
import com.slotflow.tenant.TenantOwned;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * Something a customer can book: a name, a duration, a price, and the buffers around it.
 *
 * <p>Called {@code ServiceOffering} and not {@code Service} (D8) — a JPA entity named
 * {@code Service} in a package that also holds {@code @Service} beans is a daily import mistake.
 * The REST path stays {@code /api/services} and the DTOs keep the word "service", so the wire
 * vocabulary is unaffected.
 *
 * <h2>Buffers</h2>
 * A 60-minute appointment with 10 minutes either side costs the calendar 80 minutes. The three
 * window methods below are the single definition of that arithmetic, and both the availability
 * engine (plan 09) and the booking insert (plan 10) go through them — which is what makes the
 * database's exclusion constraint and the engine agree by construction rather than by luck (D4).
 *
 * <p>Never hard-deleted while bookings reference it: {@code DELETE} deactivates (plan 07), and
 * past bookings keep their own snapshot of price and buffers (D14) so editing this row cannot
 * rewrite history.
 */
@Entity
@Table(name = "service_offering")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ServiceOffering extends AbstractMutableEntity implements TenantOwned {

    @Column(nullable = false, updatable = false)
    private UUID businessId;

    @Column(nullable = false, length = 120)
    private String name;

    /** {@code text} in the schema: a description is prose, and 255 characters is an arbitrary cliff. */
    private String description;

    @Column(nullable = false)
    private int durationMinutes;

    /** Minor units. There is no floating-point money anywhere in this codebase. */
    @Column(nullable = false)
    private long priceCents;

    /** Setup time before the appointment: the calendar loses it, the customer never sees it. */
    @Column(nullable = false)
    private int bufferBeforeMinutes;

    /** Cleanup time after. Same deal. */
    @Column(nullable = false)
    private int bufferAfterMinutes;

    @Column(nullable = false)
    private boolean active;

    public ServiceOffering(UUID businessId, String name, int durationMinutes, long priceCents) {
        this.businessId = requireNotNull(businessId, "businessId");
        this.name = requireText(name, "name");
        setDuration(durationMinutes);
        setPriceCents(priceCents);
        this.bufferBeforeMinutes = 0;
        this.bufferAfterMinutes = 0;
        this.active = true;
    }

    // ---------------------------------------------------------------------------------
    //  behaviour — the buffer arithmetic, defined once
    // ---------------------------------------------------------------------------------

    /** What one appointment actually costs the calendar: the duration plus both buffers. */
    public int totalBlockMinutes() {
        return bufferBeforeMinutes + durationMinutes + bufferAfterMinutes;
    }

    /** The end of the appointment as the customer understands it. */
    public Instant endFor(Instant start) {
        return start.plus(durationMinutes, ChronoUnit.MINUTES);
    }

    /** The start of the blocked range: {@code booking.blocked_from} (D4). */
    public Instant blockedFromFor(Instant start) {
        return start.minus(bufferBeforeMinutes, ChronoUnit.MINUTES);
    }

    /** The end of the blocked range: {@code booking.blocked_to} (D4). */
    public Instant blockedToFor(Instant start) {
        return endFor(start).plus(bufferAfterMinutes, ChronoUnit.MINUTES);
    }

    // ---------------------------------------------------------------------------------
    //  mutation
    // ---------------------------------------------------------------------------------

    public void rename(String name) {
        this.name = requireText(name, "name");
    }

    public void describe(String description) {
        this.description = description;
    }

    public void setDuration(int durationMinutes) {
        if (durationMinutes <= 0) {
            throw new IllegalArgumentException("durationMinutes must be positive");
        }
        this.durationMinutes = durationMinutes;
    }

    public void setPriceCents(long priceCents) {
        if (priceCents < 0) {
            throw new IllegalArgumentException("priceCents must not be negative");
        }
        this.priceCents = priceCents;
    }

    /** Both at once: they are one editorial decision, and the check constraint covers both. */
    public void setBuffers(int beforeMinutes, int afterMinutes) {
        if (beforeMinutes < 0 || afterMinutes < 0) {
            throw new IllegalArgumentException("buffers must not be negative");
        }
        this.bufferBeforeMinutes = beforeMinutes;
        this.bufferAfterMinutes = afterMinutes;
    }

    /** What {@code DELETE /api/services/{id}} does. Existing bookings are untouched. */
    public void deactivate() {
        this.active = false;
    }

    public void activate() {
        this.active = true;
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value.trim();
    }

    private static <T> T requireNotNull(T value, String field) {
        if (value == null) {
            throw new IllegalArgumentException(field + " must not be null");
        }
        return value;
    }
}
