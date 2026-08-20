package com.slotflow.business;

import com.slotflow.common.jpa.AbstractAuditedEntity;
import com.slotflow.tenant.TenantOwned;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.LastModifiedDate;

/**
 * The four numbers that decide which slots a customer is allowed to pick.
 *
 * <p>Exactly one policy per business, enforced by the schema rather than by convention: the
 * primary key <em>is</em> the foreign key, so there is no such thing as a second policy or an
 * orphaned one. That is also why this class extends {@link AbstractAuditedEntity} and not
 * {@code AbstractEntity} — it has no surrogate id of its own to inherit, and inheriting one would
 * map a column that does not exist. Everything else about being a row — auditing, {@code isNew()},
 * identity — comes from that shared base rather than from a second copy kept in step by hand.
 *
 * <p>The three window methods are the reason this is an entity with behaviour rather than a bag
 * of integers. They are pure functions of a {@code now} that the caller supplies, which makes
 * every policy edge case a unit test with a fixed clock and no Spring context.
 */
@Entity
@Table(name = "booking_policy")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class BookingPolicy extends AbstractAuditedEntity implements TenantOwned {

    /** The schema defaults, restated here so {@link #defaultsFor} and the DDL cannot drift apart. */
    private static final int DEFAULT_MIN_LEAD_TIME_HOURS = 2;
    private static final int DEFAULT_MAX_ADVANCE_DAYS = 60;
    private static final int DEFAULT_CANCELLATION_CUTOFF_HOURS = 24;
    private static final int DEFAULT_SLOT_GRANULARITY_MINUTES = 15;

    @Id
    @Column(name = "business_id", updatable = false)
    private UUID businessId;

    /** How soon before an appointment a customer may still book it. */
    @Column(nullable = false)
    private int minLeadTimeHours;

    /** How far ahead the calendar is open. */
    @Column(nullable = false)
    private int maxAdvanceDays;

    /** How long before the start a customer may still cancel. Staff ignore this (plan 10). */
    @Column(nullable = false)
    private int cancellationCutoffHours;

    /**
     * The step between offered start times. Governs slot <em>starts</em> only — a 45-minute
     * service on a 15-minute grid is perfectly normal, and validating durations against this
     * would be a tempting, wrong rule (plan 07).
     */
    @Column(nullable = false)
    private int slotGranularityMinutes;

    @LastModifiedDate
    @Column(nullable = false)
    private Instant updatedAt;

    public BookingPolicy(UUID businessId, int minLeadTimeHours, int maxAdvanceDays,
                         int cancellationCutoffHours, int slotGranularityMinutes) {
        this.businessId = businessId;
        setMinLeadTimeHours(minLeadTimeHours);
        setMaxAdvanceDays(maxAdvanceDays);
        setCancellationCutoffHours(cancellationCutoffHours);
        setSlotGranularityMinutes(slotGranularityMinutes);
    }

    /** What plan 05's registration creates alongside a new business, in the same transaction. */
    public static BookingPolicy defaultsFor(UUID businessId) {
        return new BookingPolicy(businessId, DEFAULT_MIN_LEAD_TIME_HOURS, DEFAULT_MAX_ADVANCE_DAYS,
                DEFAULT_CANCELLATION_CUTOFF_HOURS, DEFAULT_SLOT_GRANULARITY_MINUTES);
    }

    // ---------------------------------------------------------------------------------
    //  behaviour
    // ---------------------------------------------------------------------------------

    /** The earliest start time still bookable. Anything before it is {@code POLICY_LEAD_TIME}. */
    public Instant earliestBookableAt(Instant now) {
        return now.plus(minLeadTimeHours, ChronoUnit.HOURS);
    }

    /**
     * The end of the open calendar. Anything after it is {@code POLICY_MAX_ADVANCE}.
     *
     * <p>Exact 24-hour days, not calendar days in the business zone. A booking horizon is a
     * duration ("we take bookings two months out"), not a date, so it should not shift by an hour
     * twice a year — and a horizon that moves with DST is impossible to test deterministically.
     */
    public Instant latestBookableAt(Instant now) {
        return now.plus(maxAdvanceDays, ChronoUnit.DAYS);
    }

    /** The moment after which the customer can no longer cancel; plan 10 puts it in the 409 body. */
    public Instant cancellationDeadline(Instant startsAt) {
        return startsAt.minus(cancellationCutoffHours, ChronoUnit.HOURS);
    }

    /**
     * Strictly before the deadline. Landing exactly on it is too late — the boundary has to fall
     * one way and refusing is the side that cannot surprise a business.
     */
    public boolean isCancellable(Instant startsAt, Instant now) {
        return now.isBefore(cancellationDeadline(startsAt));
    }

    public boolean isWithinBookableWindow(Instant startsAt, Instant now) {
        return !startsAt.isBefore(earliestBookableAt(now))
                && !startsAt.isAfter(latestBookableAt(now));
    }

    // ---------------------------------------------------------------------------------
    //  mutation, each guarded by the matching CHECK constraint from V1
    // ---------------------------------------------------------------------------------

    public void setMinLeadTimeHours(int hours) {
        this.minLeadTimeHours = requireAtLeast(hours, 0, "minLeadTimeHours");
    }

    public void setMaxAdvanceDays(int days) {
        this.maxAdvanceDays = requireAtLeast(days, 1, "maxAdvanceDays");
    }

    public void setCancellationCutoffHours(int hours) {
        this.cancellationCutoffHours = requireAtLeast(hours, 0, "cancellationCutoffHours");
    }

    /**
     * The database allows 1–480. Plan 08 narrows the API to {5, 10, 15, 20, 30, 60} in request
     * validation, where a rejection can be a 422 that names the field; a granularity of 7 minutes
     * is legal arithmetic and a baffling slot list.
     */
    public void setSlotGranularityMinutes(int minutes) {
        if (minutes < 1 || minutes > 480) {
            throw new IllegalArgumentException("slotGranularityMinutes must be between 1 and 480");
        }
        this.slotGranularityMinutes = minutes;
    }

    // ---------------------------------------------------------------------------------
    //  identity — everything else comes from AbstractAuditedEntity, which keys off this
    // ---------------------------------------------------------------------------------

    @Override
    public UUID getId() {
        return businessId;
    }

    private static int requireAtLeast(int value, int minimum, String field) {
        if (value < minimum) {
            throw new IllegalArgumentException(field + " must be at least " + minimum);
        }
        return value;
    }
}
