package com.slotflow.support;

import static com.slotflow.support.fixtures.Fixtures.aBooking;
import static com.slotflow.support.fixtures.Fixtures.aBusiness;
import static com.slotflow.support.fixtures.Fixtures.aPolicy;
import static com.slotflow.support.fixtures.Fixtures.aService;
import static com.slotflow.support.fixtures.Fixtures.aStaffMember;
import static com.slotflow.support.fixtures.Fixtures.anOverride;
import static com.slotflow.support.fixtures.Fixtures.anOwner;
import static com.slotflow.support.fixtures.Fixtures.workingHours;
import static org.assertj.core.api.Assertions.assertThat;

import com.slotflow.booking.Booking;
import com.slotflow.booking.BookingStatus;
import com.slotflow.business.Business;
import com.slotflow.catalog.ServiceOffering;
import com.slotflow.staff.Role;
import com.slotflow.staff.User;
import java.time.DayOfWeek;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The builders, tested. Not because a fixture needs a test, but because <em>every</em> later test
 * relies on these defaults being what they claim: a default with a surprise in it produces a
 * confident green run that proves nothing.
 *
 * <p>It doubles as the documentation for the harness — the shortest example of each builder is here
 * rather than in a comment that will drift.
 */
class FixturesTest {

    @Test
    @DisplayName("a default business is a Paris clinic with no deposit")
    void businessDefaults() {
        Business clinic = aBusiness().withTimezone("Europe/Paris").build();

        assertThat(clinic.getTimezone().getId()).isEqualTo("Europe/Paris");
        assertThat(clinic.getCurrency().getCurrencyCode()).isEqualTo("EUR");
        assertThat(clinic.requiresDeposit()).isFalse();
        assertThat(clinic.getSlug()).startsWith("clinic-");
    }

    @Test
    @DisplayName("two default businesses do not collide on the unique slug")
    void slugsAreUnique() {
        // Without this every integration test that builds two businesses would fail on the index,
        // and the failure would point at the constraint rather than at the fixture.
        assertThat(aBusiness().build().getSlug()).isNotEqualTo(aBusiness().build().getSlug());
    }

    @Test
    @DisplayName("withDeposit turns deposits on, because that is the only way they are ever on")
    void depositBuilder() {
        Business clinic = aBusiness().withDeposit(30).build();

        assertThat(clinic.requiresDeposit()).isTrue();
        assertThat(clinic.depositFor(10_000L)).isEqualTo(3_000L);
    }

    @Test
    @DisplayName("a default service is an hour long with no buffers")
    void serviceDefaults() {
        ServiceOffering service = aService().build();

        assertThat(service.getDurationMinutes()).isEqualTo(60);
        assertThat(service.getPriceCents()).isEqualTo(5_000L);
        assertThat(service.totalBlockMinutes())
                .as("no buffers by default, so a test that mentions them is visibly about them")
                .isEqualTo(60);
        assertThat(service.isActive()).isTrue();
    }

    @Test
    @DisplayName("aService().withBuffers(10, 10) is the shorthand plan 09 will lean on")
    void serviceWithBuffers() {
        ServiceOffering service = aService().withDuration(60).withBuffers(10, 10).build();

        assertThat(service.totalBlockMinutes()).isEqualTo(80);
        assertThat(service.getBufferBeforeMinutes()).isEqualTo(10);
        assertThat(service.getBufferAfterMinutes()).isEqualTo(10);
    }

    @Test
    @DisplayName("an owner can log in; an invited staff member cannot")
    void userBuilders() {
        User owner = anOwner().build();
        User staff = aStaffMember().build();
        User pending = aStaffMember().invited().build();

        assertThat(owner.getRole()).isEqualTo(Role.OWNER);
        assertThat(owner.canLogIn()).isTrue();
        assertThat(staff.getRole()).isEqualTo(Role.STAFF);
        assertThat(staff.canLogIn()).isTrue();
        assertThat(pending.canLogIn()).isFalse();
        assertThat(pending.hasPassword()).isFalse();
    }

    @Test
    @DisplayName("emails are unique per built user, since D13 makes them globally unique")
    void emailsAreUnique() {
        assertThat(anOwner().build().getEmail()).isNotEqualTo(anOwner().build().getEmail());
    }

    @Test
    @DisplayName("a user built for a business belongs to it")
    void usersBelongToTheirBusiness() {
        Business clinic = aBusiness().build();

        assertThat(anOwner().forBusiness(clinic).build().getBusinessId())
                .isEqualTo(clinic.getId());
    }

    @Test
    @DisplayName("the default policy is the schema's own default")
    void policyDefaults() {
        assertThat(aPolicy().build().getMinLeadTimeHours()).isEqualTo(2);
        assertThat(aPolicy().build().getSlotGranularityMinutes()).isEqualTo(15);
    }

    @Test
    @DisplayName("a permissive policy gets out of the way of a test about something else")
    void permissivePolicy() {
        var policy = aPolicy().permissive().build();

        assertThat(policy.isWithinBookableWindow(TestTime.NOW, TestTime.NOW)).isTrue();
        assertThat(policy.isCancellable(TestTime.NOW.plusSeconds(1), TestTime.NOW)).isTrue();
    }

    @Test
    @DisplayName("working hours default to Monday 09:00-17:00, matching TestTime.NOW")
    void workingHoursDefaults() {
        var monday = workingHours().build();

        assertThat(monday.getDayOfWeek()).isEqualTo(DayOfWeek.MONDAY);
        assertThat(monday.durationMinutes()).isEqualTo(8 * 60);
        assertThat(monday.crossesMidnight()).isFalse();
    }

    @Test
    @DisplayName("from/to take strings, and overnight() is the midnight-crossing case")
    void workingHoursShorthands() {
        assertThat(workingHours().from("13:00").to("17:30").build().durationMinutes())
                .isEqualTo(270);
        assertThat(workingHours().overnight().build().crossesMidnight()).isTrue();
        assertThat(workingHours().buildWeekdays()).hasSize(5);
    }

    @Test
    @DisplayName("an override defaults to a whole-day block, and businessWide() drops the staff id")
    void overrideBuilders() {
        assertThat(anOverride().build().isWholeDay()).isTrue();
        assertThat(anOverride().build().isBlocked()).isTrue();
        assertThat(anOverride().businessWide().build().isBusinessWide()).isTrue();
        assertThat(anOverride().businessWide().build().getStaffId()).isNull();
        // extra() has to supply a range: a whole-day EXTRA is unrepresentable, by design.
        assertThat(anOverride().extra().build().isWholeDay()).isFalse();
        assertThat(anOverride().extra().build().isExtra()).isTrue();
    }

    @Test
    @DisplayName("a default booking is confirmed tomorrow morning")
    void bookingDefaults() {
        Booking booking = aBooking().build();

        assertThat(booking.getStatus()).isEqualTo(BookingStatus.CONFIRMED);
        assertThat(booking.getStartsAt()).isEqualTo(TestTime.NOW.plus(1, ChronoUnit.DAYS));
        assertThat(booking.getExpiresAt()).isNull();
        assertThat(booking.isActive()).isTrue();
    }

    @Test
    @DisplayName("a booking derives its blocked window from the service it was built for")
    void bookingUsesItsServicesBuffers() {
        ServiceOffering service = aService().withDuration(60).withBuffers(10, 15).build();

        Booking booking = aBooking().forService(service).at("2026-03-04T09:00:00Z").build();

        // The point of passing a real service rather than a duration and a price: the blocked
        // window and the snapshotted terms cannot disagree with any service that exists.
        assertThat(booking.getEndsAt()).isEqualTo("2026-03-04T10:00:00Z");
        assertThat(booking.getBlockedFrom()).isEqualTo("2026-03-04T08:50:00Z");
        assertThat(booking.getBlockedTo()).isEqualTo("2026-03-04T10:15:00Z");
        assertThat(booking.getBusinessId()).isEqualTo(service.getBusinessId());
    }

    @Test
    @DisplayName("awaitingDeposit() holds the slot with a 30-minute expiry (D3)")
    void pendingBookingBuilder() {
        Booking booking = aBooking().awaitingDeposit().build();

        assertThat(booking.getStatus()).isEqualTo(BookingStatus.PENDING);
        assertThat(booking.getExpiresAt())
                .isEqualTo(TestTime.NOW.plus(30, ChronoUnit.MINUTES));
        assertThat(booking.isActive())
                .as("a deposit in flight is not a free calendar")
                .isTrue();
    }

    @Test
    @DisplayName("inHours and inDays are relative to the suite's pinned instant")
    void relativeScheduling() {
        assertThat(aBooking().inHours(3).build().getStartsAt())
                .isEqualTo(TestTime.NOW.plus(3, ChronoUnit.HOURS));
        assertThat(aBooking().inDays(10).build().getStartsAt())
                .isEqualTo(TestTime.NOW.plus(10, ChronoUnit.DAYS));
    }
}
