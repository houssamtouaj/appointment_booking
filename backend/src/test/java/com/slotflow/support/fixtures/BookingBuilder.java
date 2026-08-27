package com.slotflow.support.fixtures;

import com.slotflow.booking.Booking;
import com.slotflow.booking.GuestContact;
import com.slotflow.business.Business;
import com.slotflow.catalog.ServiceOffering;
import com.slotflow.staff.User;
import com.slotflow.support.TestTime;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

/**
 * A booking. Defaults to a confirmed one, tomorrow morning, for a default service.
 *
 * <p>The service is a real {@link ServiceOffering} rather than a duration and a price, because the
 * booking derives its blocked window from it (D4) and snapshots its terms (D14). Passing the parts
 * separately would let a test build a booking whose blocked range does not match any service,
 * which is a state the application can never produce.
 *
 * <p>Note what this builder does <em>not</em> offer: a way to set a status directly. The terminal
 * statuses are reached by walking the machine, exactly as production does, because a fixture that
 * writes {@code status = COMPLETED} into a future appointment tests a row that cannot exist.
 */
public final class BookingBuilder {

    private UUID businessId;
    private ServiceOffering service;
    private UUID staffId = UUID.randomUUID();
    private Instant startsAt = TestTime.NOW.plus(1, ChronoUnit.DAYS);
    private GuestContact guest = new GuestContact("Alex Guest", "alex@example.test", null);
    private String notes;
    private Instant depositExpiresAt;

    BookingBuilder() {}

    public BookingBuilder forBusiness(Business business) {
        return forBusiness(business.getId());
    }

    public BookingBuilder forBusiness(UUID businessId) {
        this.businessId = businessId;
        return this;
    }

    /** Also fixes the business, since a booking and its service always share one. */
    public BookingBuilder forService(ServiceOffering service) {
        this.service = service;
        this.businessId = service.getBusinessId();
        return this;
    }

    public BookingBuilder withStaff(User staff) {
        return withStaff(staff.getId());
    }

    public BookingBuilder withStaff(UUID staffId) {
        this.staffId = staffId;
        return this;
    }

    public BookingBuilder at(Instant startsAt) {
        this.startsAt = startsAt;
        return this;
    }

    public BookingBuilder at(String isoInstant) {
        return at(Instant.parse(isoInstant));
    }

    /** Relative to {@code TestTime.NOW}, which is what most tests actually mean. */
    public BookingBuilder inHours(long hours) {
        return at(TestTime.NOW.plus(hours, ChronoUnit.HOURS));
    }

    public BookingBuilder inDays(long days) {
        return at(TestTime.NOW.plus(days, ChronoUnit.DAYS));
    }

    public BookingBuilder forGuest(String name, String email) {
        this.guest = new GuestContact(name, email, null);
        return this;
    }

    public BookingBuilder forGuest(GuestContact guest) {
        this.guest = guest;
        return this;
    }

    public BookingBuilder withNotes(String notes) {
        this.notes = notes;
        return this;
    }

    /** Holding a slot while the customer is at Stripe, expiring 30 minutes from now (D3). */
    public BookingBuilder awaitingDeposit() {
        return awaitingDepositUntil(TestTime.NOW.plus(30, ChronoUnit.MINUTES));
    }

    public BookingBuilder awaitingDepositUntil(Instant expiresAt) {
        this.depositExpiresAt = expiresAt;
        return this;
    }

    public Booking build() {
        ServiceOffering bookedService = service != null
                ? service
                : new ServiceOfferingBuilder().forBusiness(businessOrRandom()).build();
        UUID business = businessId != null ? businessId : bookedService.getBusinessId();

        return depositExpiresAt == null
                ? Booking.confirmed(business, bookedService, staffId, startsAt, guest, notes)
                : Booking.awaitingDeposit(business, bookedService, staffId, startsAt, guest, notes,
                        depositExpiresAt);
    }

    private UUID businessOrRandom() {
        return businessId != null ? businessId : UUID.randomUUID();
    }
}
