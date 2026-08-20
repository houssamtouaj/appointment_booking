package com.slotflow.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.slotflow.catalog.ServiceOffering;
import com.slotflow.common.error.ErrorCode;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/**
 * The transition matrix from plan 10, enforced where it belongs — inside the entity.
 *
 * <p>Plain JUnit: no Spring, no database, one fixed clock. That is the whole argument for putting
 * the rules on the entity rather than in a service. Twenty combinations become a table instead of
 * twenty endpoint tests, and they run in milliseconds.
 */
class BookingTransitionTest {

    /** A Monday morning. Fixed so a failure reads identically on every machine and in CI. */
    private static final Instant NINE_AM = Instant.parse("2026-03-02T09:00:00Z");

    /** When the customer booked: two days before the appointment, so the 30-minute deposit
     *  hold (D3) sits well in the past by the time the appointment itself comes around. */
    private static final Instant BOOKED_AT = NINE_AM.minus(2, ChronoUnit.DAYS);

    /** Well after the appointment has ended, so the time guards are out of the way. */
    private static final Clock AFTERWARDS =
            Clock.fixed(NINE_AM.plus(3, ChronoUnit.HOURS), ZoneOffset.UTC);

    private static final UUID BUSINESS_ID = UUID.randomUUID();
    private static final UUID STAFF_ID = UUID.randomUUID();

    /**
     * The matrix, transcribed. Every row here is a row of the table in plan 10, and a change to
     * either has to be a change to both.
     */
    @ParameterizedTest(name = "{0} -> {1} allowed: {2}")
    @CsvSource({
            "PENDING,   CONFIRM,  true",
            "PENDING,   CANCEL,   true",
            "PENDING,   COMPLETE, false",
            "PENDING,   NO_SHOW,  false",

            "CONFIRMED, CONFIRM,  false",
            "CONFIRMED, CANCEL,   true",
            "CONFIRMED, COMPLETE, true",
            "CONFIRMED, NO_SHOW,  true",

            "CANCELLED, CONFIRM,  false",
            "CANCELLED, CANCEL,   false",
            "CANCELLED, COMPLETE, false",
            "CANCELLED, NO_SHOW,  false",

            "COMPLETED, CONFIRM,  false",
            "COMPLETED, CANCEL,   false",
            "COMPLETED, COMPLETE, false",
            "COMPLETED, NO_SHOW,  false",

            "NO_SHOW,   CONFIRM,  false",
            "NO_SHOW,   CANCEL,   true",
            "NO_SHOW,   COMPLETE, true",
            "NO_SHOW,   NO_SHOW,  false",
    })
    void enforcesTheTransitionMatrix(BookingStatus from, Transition transition, boolean allowed) {
        Booking booking = bookingIn(from);

        if (allowed) {
            assertThatCode(() -> transition.applyTo(booking, AFTERWARDS.instant()))
                    .doesNotThrowAnyException();
            assertThat(booking.getStatus()).isEqualTo(transition.target);
        } else {
            assertThatThrownBy(() -> transition.applyTo(booking, AFTERWARDS.instant()))
                    .isInstanceOf(IllegalBookingTransitionException.class);
            assertThat(booking.getStatus())
                    .as("a refused transition must leave the booking exactly as it was")
                    .isEqualTo(from);
        }
    }

    @Test
    @DisplayName("a refused transition names both states, so the client can resync its badge")
    void refusalNamesBothStates() {
        Booking cancelled = bookingIn(BookingStatus.CANCELLED);

        assertThatThrownBy(() -> cancelled.confirm())
                .isInstanceOf(IllegalBookingTransitionException.class)
                .satisfies(thrown -> {
                    IllegalBookingTransitionException ex = (IllegalBookingTransitionException) thrown;
                    assertThat(ex.code()).isEqualTo(ErrorCode.ILLEGAL_TRANSITION);
                    assertThat(ex.status().value()).isEqualTo(409);
                    assertThat(ex.properties())
                            .containsEntry("from", "CANCELLED")
                            .containsEntry("to", "CONFIRMED");
                });
    }

    @Nested
    @DisplayName("the time guards")
    class TimeGuards {

        @Test
        @DisplayName("a booking cannot be completed before it has ended")
        void completeBeforeTheEndIsRefused() {
            Booking booking = bookingIn(BookingStatus.CONFIRMED);
            // One minute before the end: the appointment is happening, not finished.
            Instant duringTheAppointment = NINE_AM.plus(59, ChronoUnit.MINUTES);

            assertThatThrownBy(() -> booking.complete(duringTheAppointment))
                    .isInstanceOf(IllegalBookingTransitionException.class)
                    .hasMessageContaining("has not finished");
            assertThat(booking.getStatus()).isEqualTo(BookingStatus.CONFIRMED);
        }

        @Test
        @DisplayName("completing exactly at the end instant is allowed")
        void completeAtTheEndInstantIsAllowed() {
            Booking booking = bookingIn(BookingStatus.CONFIRMED);

            booking.complete(booking.getEndsAt());

            assertThat(booking.getStatus()).isEqualTo(BookingStatus.COMPLETED);
        }

        @Test
        @DisplayName("a no-show cannot be recorded before the appointment was due to start")
        void noShowBeforeTheStartIsRefused() {
            Booking booking = bookingIn(BookingStatus.CONFIRMED);
            Instant beforeTheStart = NINE_AM.minus(1, ChronoUnit.MINUTES);

            assertThatThrownBy(() -> booking.markNoShow(beforeTheStart))
                    .isInstanceOf(IllegalBookingTransitionException.class)
                    .hasMessageContaining("has not started");
        }

        @Test
        @DisplayName("correcting a no-show to completed still waits for the appointment to end")
        void correctingANoShowIsTimeGuardedToo() {
            Booking booking = bookingIn(BookingStatus.CONFIRMED);
            booking.markNoShow(NINE_AM.plus(5, ChronoUnit.MINUTES));

            // The customer turned up late; the owner tries to fix it mid-appointment. An
            // appointment that has not ended cannot have been completed, whatever it says now.
            assertThatThrownBy(() -> booking.complete(NINE_AM.plus(30, ChronoUnit.MINUTES)))
                    .isInstanceOf(IllegalBookingTransitionException.class);

            booking.complete(NINE_AM.plus(61, ChronoUnit.MINUTES));
            assertThat(booking.getStatus()).isEqualTo(BookingStatus.COMPLETED);
        }
    }

    @Nested
    @DisplayName("side effects of a transition")
    class SideEffects {

        @Test
        @DisplayName("confirming drops the expiry: the hold is over, the booking is real")
        void confirmingClearsTheExpiry() {
            Booking pending = bookingIn(BookingStatus.PENDING);
            assertThat(pending.getExpiresAt()).isNotNull();

            pending.confirm();

            assertThat(pending.getExpiresAt())
                    .as("a confirmed booking the sweeper could still see would be cancelled by it")
                    .isNull();
            assertThat(pending.isActive()).isTrue();
        }

        @Test
        @DisplayName("cancelling releases the slot, which is what the constraint's WHERE clause does")
        void cancellingReleasesTheSlot() {
            Booking booking = bookingIn(BookingStatus.CONFIRMED);

            booking.cancel();

            assertThat(booking.isActive()).isFalse();
            assertThat(booking.getExpiresAt()).isNull();
        }

        @Test
        @DisplayName("a pending booking past its expiry is visible to the sweeper")
        void expiryIsDetectable() {
            Booking pending = bookingIn(BookingStatus.PENDING);
            Instant expiry = pending.getExpiresAt();

            assertThat(pending.hasExpired(expiry.minusSeconds(1))).isFalse();
            assertThat(pending.hasExpired(expiry.plusSeconds(1))).isTrue();
        }

        @Test
        @DisplayName("a confirmed booking never looks expired, whatever the clock says")
        void confirmedBookingsNeverExpire() {
            Booking confirmed = bookingIn(BookingStatus.CONFIRMED);

            assertThat(confirmed.hasExpired(NINE_AM.plus(365, ChronoUnit.DAYS))).isFalse();
        }
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    /** The four mutators, as data, so the matrix above can be a table. */
    enum Transition {
        CONFIRM(BookingStatus.CONFIRMED),
        CANCEL(BookingStatus.CANCELLED),
        COMPLETE(BookingStatus.COMPLETED),
        NO_SHOW(BookingStatus.NO_SHOW);

        private final BookingStatus target;

        Transition(BookingStatus target) {
            this.target = target;
        }

        void applyTo(Booking booking, Instant now) {
            switch (this) {
                case CONFIRM -> booking.confirm();
                case CANCEL -> booking.cancel();
                case COMPLETE -> booking.complete(now);
                case NO_SHOW -> booking.markNoShow(now);
            }
        }
    }

    /**
     * Every status is reached by walking the machine, never by writing the field. If a status is
     * unreachable through the public API, a test that fakes its way into it proves nothing.
     */
    private static Booking bookingIn(BookingStatus status) {
        return switch (status) {
            case PENDING -> pendingBooking();
            case CONFIRMED -> confirmedBooking();
            case CANCELLED -> {
                Booking booking = confirmedBooking();
                booking.cancel();
                yield booking;
            }
            case COMPLETED -> {
                Booking booking = confirmedBooking();
                booking.complete(AFTERWARDS.instant());
                yield booking;
            }
            case NO_SHOW -> {
                Booking booking = confirmedBooking();
                booking.markNoShow(AFTERWARDS.instant());
                yield booking;
            }
        };
    }

    private static Booking confirmedBooking() {
        return Booking.confirmed(BUSINESS_ID, service(), STAFF_ID, NINE_AM, guest(), null);
    }

    private static Booking pendingBooking() {
        return Booking.awaitingDeposit(BUSINESS_ID, service(), STAFF_ID, NINE_AM, guest(), null,
                BOOKED_AT.plus(30, ChronoUnit.MINUTES));
    }

    private static ServiceOffering service() {
        return new ServiceOffering(BUSINESS_ID, "Consultation", 60, 5_000L);
    }

    private static GuestContact guest() {
        return new GuestContact("Alex Guest", "alex@example.test", null);
    }
}
