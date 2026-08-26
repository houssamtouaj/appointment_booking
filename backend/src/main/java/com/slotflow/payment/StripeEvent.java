package com.slotflow.payment;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.springframework.data.domain.Persistable;

/**
 * One Stripe event that has already been applied.
 *
 * <h2>The primary key is Stripe's id, and that is the whole design</h2>
 * Every other entity in this schema assigns itself a UUID. This one cannot: the identity that
 * matters is the sender's, because the question being answered is "have I seen <em>this delivery's
 * event</em> before?" and only Stripe knows the answer to that. A surrogate key here would make two
 * deliveries of one event two perfectly valid rows, which is the same as having no table.
 *
 * <h2>{@link Persistable}, and why {@code isNew} is unconditionally true</h2>
 * With an assigned id, {@code SimpleJpaRepository.save()} would call {@code merge}, which reads the
 * row and then <em>updates</em> it — turning the replay this table exists to catch into a silent
 * no-op that reports success. Forcing {@code persist} makes a second insert of the same event id a
 * duplicate-key violation, which is a guarantee from Postgres rather than a check somebody
 * remembered to write. {@link StripeWebhookService} catches it and treats it as "already applied",
 * which is exactly what it is.
 *
 * <p>There is therefore no update path and no {@code @Version}: a row here is written once and read
 * afterwards. It is a fact about the past.
 */
@Entity
@Table(name = "stripe_event")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class StripeEvent implements Persistable<String> {

    @Id
    @Column(length = 255, updatable = false)
    private String id;

    @Column(nullable = false, length = 120, updatable = false)
    private String type;

    /**
     * The booking this event moved, when the payload named one.
     *
     * <p>Nullable, and not a foreign key. An event whose booking has since been deleted must not
     * make this insert fail: a webhook that answers 500 is a webhook Stripe retries for three days,
     * so a tidy-up in a demo database would turn into a permanent stream of retries. The column is
     * for whoever is reading the table to work out why a booking changed.
     */
    @Column(updatable = false)
    private UUID bookingId;

    @Column(nullable = false, updatable = false)
    private Instant receivedAt;

    public StripeEvent(String id, String type, UUID bookingId, Instant receivedAt) {
        this.id = id;
        this.type = type;
        this.bookingId = bookingId;
        this.receivedAt = receivedAt;
    }

    /** Always. See the class note: {@code merge} would make a replay look like a success. */
    @Override
    public boolean isNew() {
        return true;
    }
}
