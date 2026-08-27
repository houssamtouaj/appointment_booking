package com.slotflow.notification;

import java.math.BigDecimal;
import java.text.NumberFormat;
import java.util.Currency;
import java.util.Locale;

/**
 * Minor units to something a customer can read.
 *
 * <p>Prices live as {@code long} cents everywhere in this codebase and are converted to a decimal
 * exactly once, here, at the last possible moment. {@link BigDecimal#movePointLeft} rather than a
 * division by 100.0 for the reason the {@code Business.depositFor} javadoc gives at more length:
 * there is no {@code double} anywhere near a price, and "€45.00" printed as "€44.99" is a support
 * ticket about honesty rather than about arithmetic.
 *
 * <p>{@code Locale.ENGLISH} pins the grouping and the decimal separator, so the same build produces
 * the same email on a French laptop and an American CI runner. The currency symbol still comes from
 * the business's own {@link Currency}, which is the part that actually varies between tenants.
 *
 * <p>Two minor units assumed, which is true of every currency this project takes deposits in.
 * {@code NumberFormat} reads the real fraction digits from the currency itself, so a zero-decimal
 * currency such as JPY renders as "¥4500" rather than as "¥45.00" — the conversion is the
 * currency's business, not this method's.
 */
final class Money {

    private Money() {}

    static String format(long minorUnits, Currency currency) {
        NumberFormat format = NumberFormat.getCurrencyInstance(Locale.ENGLISH);
        format.setCurrency(currency);
        format.setMinimumFractionDigits(currency.getDefaultFractionDigits());
        format.setMaximumFractionDigits(currency.getDefaultFractionDigits());
        return format.format(
                BigDecimal.valueOf(minorUnits).movePointLeft(currency.getDefaultFractionDigits()));
    }
}
