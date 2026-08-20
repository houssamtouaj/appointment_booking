package com.slotflow.common.jpa;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;
import java.util.Currency;

/**
 * Stores a {@link Currency} as its ISO 4217 code, which is what the {@code varchar(3)} column
 * and its {@code ^[A-Z]{3}$} check constraint already expect.
 *
 * <p>Using the real type rather than a {@code String} means an entity cannot hold "EURO" or
 * "eur", and it is what tells Stripe's API and a price formatter the same thing.
 */
@Converter(autoApply = true)
public class CurrencyConverter implements AttributeConverter<Currency, String> {

    @Override
    public String convertToDatabaseColumn(Currency currency) {
        return currency == null ? null : currency.getCurrencyCode();
    }

    @Override
    public Currency convertToEntityAttribute(String code) {
        return code == null ? null : Currency.getInstance(code);
    }
}
