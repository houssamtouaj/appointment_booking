package com.slotflow.common.jpa;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;
import java.time.ZoneId;

/**
 * Stores a {@link ZoneId} as its IANA name: {@code Europe/Paris}, not an offset.
 *
 * <p>An offset would be wrong, not merely less readable. {@code +02:00} is what Paris happens to
 * be in July; the business means "the zone that Paris is in", including its DST rules, because
 * that is what decides whether 09:00 next March is 08:00 or 07:00 UTC. Plan 09's DST tests exist
 * to prove that distinction, and they need the zone id to make it.
 *
 * <p>Applied automatically to every {@code ZoneId} field, so no mapping can opt out and store
 * something else.
 */
@Converter(autoApply = true)
public class ZoneIdConverter implements AttributeConverter<ZoneId, String> {

    @Override
    public String convertToDatabaseColumn(ZoneId zone) {
        return zone == null ? null : zone.getId();
    }

    /**
     * Deliberately unguarded: an unparseable zone in the database is corruption, and
     * {@code ZoneId.of} throwing on read is the loudest, earliest place to find out. Swallowing
     * it and defaulting to UTC would silently move every appointment the business has.
     */
    @Override
    public ZoneId convertToEntityAttribute(String zoneId) {
        return zoneId == null ? null : ZoneId.of(zoneId);
    }
}
