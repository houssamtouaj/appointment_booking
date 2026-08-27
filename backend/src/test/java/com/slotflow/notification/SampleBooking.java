package com.slotflow.notification;

import com.slotflow.notification.NotificationService.Recipient;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Currency;
import java.util.UUID;

/**
 * A {@link BookingNotification} to render, without a database behind it.
 *
 * <p>The record is a flat bag of values by design — that is the whole point of resolving it in
 * {@code BookingNotificationFactory} — so a template test needs no Spring context, no fixtures and
 * no tenant. It needs sixteen values and a way to vary the three or four that a given assertion is
 * about, which is what this is.
 *
 * <p>Paris in October, deliberately: {@code CEST} is a zone abbreviation that differs from UTC and
 * differs from the same zone in January, so a formatter that silently drops the zone, or renders it
 * from the wrong instant, produces a visibly wrong string rather than a coincidentally right one.
 */
final class SampleBooking {

    static final UUID BOOKING_ID = UUID.fromString("6f1c9b60-8f77-4a4a-9f0e-2b0f2f7a1c11");
    static final UUID CANCELLATION_TOKEN = UUID.fromString("11111111-2222-3333-4444-555555555555");

    /** 13:00 Paris on Wednesday 14 October 2026 — 11:00 UTC, and CEST is still in force. */
    static final Instant STARTS_AT = Instant.parse("2026-10-14T11:00:00Z");

    private String businessName = "Dana Salon";
    private String serviceName = "Haircut";
    private String staffName = "Dana Owner";
    private ZoneId zone = ZoneId.of("Europe/Paris");
    private long priceCents = 4500;
    private long depositDueCents;
    private long depositPaidCents;
    private Instant holdExpiresAt;
    private String checkoutUrl;

    static SampleBooking paris() {
        return new SampleBooking();
    }

    SampleBooking businessName(String businessName) {
        this.businessName = businessName;
        return this;
    }

    SampleBooking serviceName(String serviceName) {
        this.serviceName = serviceName;
        return this;
    }

    SampleBooking inZone(ZoneId zone) {
        this.zone = zone;
        return this;
    }

    /** A booking whose deposit is still owed: what {@code booking-received} renders. */
    SampleBooking awaitingDeposit(long dueCents, String checkoutUrl) {
        this.depositDueCents = dueCents;
        this.checkoutUrl = checkoutUrl;
        this.holdExpiresAt = STARTS_AT.minusSeconds(3600);
        return this;
    }

    /** A booking whose deposit arrived: what {@code booking-confirmed} renders after the webhook. */
    SampleBooking depositPaid(long paidCents) {
        this.depositDueCents = paidCents;
        this.depositPaidCents = paidCents;
        return this;
    }

    BookingNotification build() {
        return new BookingNotification(
                new Recipient("alex@example.test", "Alex Guest"),
                BOOKING_ID,
                CANCELLATION_TOKEN,
                businessName,
                zone,
                serviceName,
                staffName,
                STARTS_AT,
                STARTS_AT.plusSeconds(3600),
                Currency.getInstance("EUR"),
                priceCents,
                depositDueCents,
                depositPaidCents,
                holdExpiresAt,
                checkoutUrl,
                "https://app.slotflow.test/booking/" + CANCELLATION_TOKEN);
    }
}
