package com.slotflow.business;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.ZoneId;
import java.util.Currency;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * Deposit arithmetic and the two fields that are load-bearing rather than decorative.
 *
 * <p>The rounding cases are the reason this test exists. A deposit that is one cent away from what
 * Stripe charged is a reconciliation problem, not a rounding curiosity, and the only way to be sure
 * is to pin the awkward numbers down.
 */
class BusinessTest {

    @Test
    @DisplayName("a business starts with no deposit policy at all")
    void startsWithoutADeposit() {
        Business business = business();

        assertThat(business.requiresDeposit()).isFalse();
        assertThat(business.depositFor(10_000L)).isZero();
    }

    @ParameterizedTest(name = "{1}% of {0} cents is {2}")
    @CsvSource({
            // exact multiples: no rounding involved
            "10000, 20, 2000",
            "5000,  50, 2500",
            "2500,  25, 625",
            // 1234 * 30% = 370.2 -> 370
            "1234,  30, 370",
            // 1235 * 30% = 370.5 -> 371, the half-up boundary
            "1235,  30, 371",
            // 999 * 33% = 329.67 -> 330
            "999,   33, 330",
            // a 100% deposit is the whole price, not a rounding error above it
            "7777, 100, 7777",
            // one cent, any percentage: never more than the price
            "1,     50, 1",
    })
    void roundsDepositsHalfUp(long priceCents, int percent, long expectedDeposit) {
        Business business = business();
        business.setDepositPolicy(true, percent);

        assertThat(business.depositFor(priceCents)).isEqualTo(expectedDeposit);
    }

    @Test
    @DisplayName("a deposit percentage of zero means no deposit, whatever the flag says")
    void zeroPercentIsNoDeposit() {
        Business business = business();
        // The schema allows this combination and it has no useful meaning: it would create a
        // PENDING booking, send the customer to Stripe for nothing, and hold the slot for
        // 30 minutes against a payment of zero.
        business.setDepositPolicy(true, 0);

        assertThat(business.requiresDeposit()).isFalse();
        assertThat(business.depositFor(10_000L)).isZero();
    }

    @Test
    @DisplayName("a free service never asks for a deposit")
    void freeServicesTakeNoDeposit() {
        Business business = business();
        business.setDepositPolicy(true, 50);

        assertThat(business.depositFor(0L)).isZero();
    }

    @ParameterizedTest
    @ValueSource(ints = { -1, 101, 1000 })
    @DisplayName("a percentage outside 0-100 is refused before the database sees it")
    void refusesImpossiblePercentages(int percent) {
        Business business = business();

        assertThatThrownBy(() -> business.setDepositPolicy(true, percent))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("a slug is lower-cased and trimmed rather than rejected for capitals")
    void normalisesTheSlug() {
        Business business = new Business("  Dana-Clinic  ", "Dana Clinic",
                ZoneId.of("Europe/Paris"), Currency.getInstance("EUR"));

        assertThat(business.getSlug()).isEqualTo("dana-clinic");
    }

    @ParameterizedTest
    @ValueSource(strings = { "ab", "has spaces", "under_score", "Ünïcode", "dots.not.allowed" })
    @DisplayName("a slug that would fail the check constraint fails here first")
    void refusesAnUnusableSlug(String slug) {
        assertThatThrownBy(() -> new Business(slug, "Name",
                ZoneId.of("Europe/Paris"), Currency.getInstance("EUR")))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("a business is its own tenant, so the guard needs no special case for it")
    void isItsOwnTenant() {
        Business business = business();

        assertThat(business.getBusinessId()).isEqualTo(business.getId());
    }

    @Test
    @DisplayName("the timezone is stored as a zone, not an offset, so DST rules travel with it")
    void keepsTheZoneRatherThanAnOffset() {
        Business business = business();

        // +02:00 is what Paris happens to be in July. The zone is what decides whether 09:00
        // next March is 08:00 or 07:00 UTC, and that is what plan 09's DST tests need.
        assertThat(business.getTimezone().getId()).isEqualTo("Europe/Paris");
        assertThat(business.getTimezone().getRules().isDaylightSavings(
                java.time.Instant.parse("2026-07-01T12:00:00Z"))).isTrue();
    }

    private static Business business() {
        return new Business("dana-clinic", "Dana Clinic",
                ZoneId.of("Europe/Paris"), Currency.getInstance("EUR"));
    }
}
