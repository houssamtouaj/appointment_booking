package com.slotflow.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The buffer arithmetic, which the availability engine and the database's exclusion constraint
 * both depend on being the same arithmetic (D4).
 *
 * <p>Small tests for a small amount of code, and worth writing anyway: an off-by-one on
 * {@code blockedFromFor} does not fail anywhere. It quietly lets the constraint under-protect,
 * and the symptom is a double booking three plans later.
 */
class ServiceOfferingTest {

    private static final Instant NINE_AM = Instant.parse("2026-03-02T09:00:00Z");
    private static final UUID BUSINESS_ID = UUID.randomUUID();

    @Test
    @DisplayName("with no buffers the blocked window is exactly the appointment")
    void withoutBuffersTheWindowIsTheAppointment() {
        ServiceOffering service = service();

        assertThat(service.endFor(NINE_AM)).isEqualTo(Instant.parse("2026-03-02T10:00:00Z"));
        assertThat(service.blockedFromFor(NINE_AM)).isEqualTo(NINE_AM);
        assertThat(service.blockedToFor(NINE_AM)).isEqualTo(service.endFor(NINE_AM));
        assertThat(service.totalBlockMinutes()).isEqualTo(60);
    }

    @Test
    @DisplayName("buffers widen the blocked window on both sides without moving the appointment")
    void buffersWidenTheBlockedWindow() {
        ServiceOffering service = service();
        service.setBuffers(10, 15);

        // 60 minutes of appointment costs the calendar 85. That gap is the whole reason the
        // exclusion constraint ranges over blocked_from/blocked_to rather than starts_at/ends_at.
        assertThat(service.totalBlockMinutes()).isEqualTo(85);
        assertThat(service.blockedFromFor(NINE_AM)).isEqualTo(Instant.parse("2026-03-02T08:50:00Z"));
        assertThat(service.blockedToFor(NINE_AM)).isEqualTo(Instant.parse("2026-03-02T10:15:00Z"));
        assertThat(service.endFor(NINE_AM))
                .as("the customer's appointment is unaffected by buffers")
                .isEqualTo(Instant.parse("2026-03-02T10:00:00Z"));
    }

    @Test
    @DisplayName("asymmetric buffers are not silently symmetrical")
    void asymmetricBuffersStayAsymmetric() {
        ServiceOffering service = service();
        service.setBuffers(0, 20);

        assertThat(service.blockedFromFor(NINE_AM)).isEqualTo(NINE_AM);
        assertThat(service.blockedToFor(NINE_AM)).isEqualTo(Instant.parse("2026-03-02T10:20:00Z"));
    }

    @Test
    @DisplayName("a new service is active and free of buffers")
    void newServiceDefaults() {
        ServiceOffering service = service();

        assertThat(service.isActive()).isTrue();
        assertThat(service.getBufferBeforeMinutes()).isZero();
        assertThat(service.getBufferAfterMinutes()).isZero();
    }

    @Test
    @DisplayName("deactivating hides a service without touching anything else about it")
    void deactivateIsTheSoftDelete() {
        ServiceOffering service = service();
        service.setPriceCents(9_900L);

        service.deactivate();

        assertThat(service.isActive()).isFalse();
        assertThat(service.getPriceCents())
                .as("a soft delete is a visibility change, not a data change")
                .isEqualTo(9_900L);
    }

    @Test
    @DisplayName("values the check constraints reject are refused in Java first")
    void refusesInvalidValues() {
        ServiceOffering service = service();

        assertThatThrownBy(() -> service.setDuration(0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.setPriceCents(-1L))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.setBuffers(-1, 0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.setBuffers(0, -1))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("a free service is legal: not everything bookable costs money")
    void aFreeServiceIsLegal() {
        ServiceOffering consultation = new ServiceOffering(BUSINESS_ID, "Free consultation", 15, 0L);

        assertThat(consultation.getPriceCents()).isZero();
    }

    private static ServiceOffering service() {
        return new ServiceOffering(BUSINESS_ID, "Consultation", 60, 5_000L);
    }
}
