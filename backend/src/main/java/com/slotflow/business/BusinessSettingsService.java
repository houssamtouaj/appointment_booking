package com.slotflow.business;

import com.slotflow.booking.BookingRepository;
import com.slotflow.common.error.ApiException;
import com.slotflow.common.error.ErrorCode;
import com.slotflow.tenant.TenantContext;
import java.time.Clock;
import java.time.ZoneId;
import java.util.Currency;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The tenant's own settings: name, timezone, currency and deposit rule.
 *
 * <p>No tenant guard in sight, and that is correct rather than an oversight: there is no id in the
 * path to reach with. The business under edit is {@link TenantContext#businessId()}, which comes from
 * the token's {@code bid} claim, so "another tenant's settings" is not a request this endpoint can
 * express — the same reason {@code /api/policy} needs no guard either. What it does need is a role
 * check, and that is an annotation on the controller.
 */
@Service
public class BusinessSettingsService {

    private static final Logger log = LoggerFactory.getLogger(BusinessSettingsService.class);

    private final BusinessRepository businesses;
    private final BookingRepository bookings;
    private final TenantContext tenant;
    private final Clock clock;

    public BusinessSettingsService(BusinessRepository businesses, BookingRepository bookings,
                                  TenantContext tenant, Clock clock) {
        this.businesses = businesses;
        this.bookings = bookings;
        this.tenant = tenant;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public BusinessResponse get() {
        return BusinessResponse.of(business());
    }

    /**
     * Applies the settings, refusing a timezone move that nobody has confirmed.
     *
     * <h2>Why the timezone is different from the other three</h2>
     * Working hours are {@code LocalTime}, interpreted in <em>this</em> zone (D11). "09:00 on Tuesdays"
     * is therefore not a fact about a moment until this field says which moment it is, so moving the
     * zone silently moves every future slot the engine will ever compute — and every customer already
     * holding a confirmation for one of them keeps their instant while the staff member's calendar
     * moves underneath it. That is a decision for a person, not a side effect of saving a form, so
     * the first attempt is a {@code 409 TIMEZONE_SHIFT_UNCONFIRMED} carrying the count of future
     * bookings involved and the second — with {@code confirmShift: true} — goes through.
     *
     * <p>The 409 is returned even when the count is zero. The bookings are the visible consequence,
     * not the reason: a business with an empty calendar and a full week of working hours is still
     * about to change what "we open at nine" means, and an endpoint that only asks when it happens to
     * have something to warn about is an endpoint whose behaviour nobody can predict.
     *
     * <p><b>Nothing is normalised.</b> Plan 08 is explicit about this and it is worth restating: the
     * hours are not rewritten to keep their old instants, and the bookings are not moved. Rewriting
     * either would be the application inventing an intention, and there is no way for it to know
     * which one the operator had.
     */
    @Transactional
    public BusinessResponse update(BusinessRequest request) {
        Business business = business();
        ZoneId previous = business.getTimezone();
        ZoneId timezone = BusinessFields.timezone(request.timezone());
        Currency currency = BusinessFields.currency(request.currency());

        boolean moves = !timezone.equals(previous);
        if (moves && !request.isShiftConfirmed()) {
            long affected = bookings.countUpcomingActive(business.getId(), clock.instant());
            throw new ApiException(ErrorCode.TIMEZONE_SHIFT_UNCONFIRMED,
                    ("Changing the timezone from %s to %s moves every future slot. "
                            + "Send confirmShift: true to proceed.")
                            .formatted(previous.getId(), timezone.getId()))
                    .with("currentTimezone", previous.getId())
                    .with("requestedTimezone", timezone.getId())
                    .with("affectedBookings", affected);
        }

        business.rename(request.name());
        if (moves) {
            business.moveToTimezone(timezone);
            // Read from the captured value, not from the entity: by this line the entity already
            // holds the new zone, and a log line claiming a business moved from Europe/Paris to
            // Europe/Paris is worse than no log line.
            log.warn("Business {} moved from {} to {}", business.getId(),
                    previous.getId(), timezone.getId());
        }
        business.changeCurrency(currency);
        business.setDepositPolicy(request.depositRequired(), request.depositPercent());
        return BusinessResponse.of(businesses.save(business));
    }

    /**
     * The tenant in the token must exist: the {@code bid} claim was put there by this application
     * against a row it had just read, and the foreign key cascades. A missing one is a broken
     * invariant rather than a client error.
     */
    private Business business() {
        return businesses.findById(tenant.businessId())
                .orElseThrow(() -> new IllegalStateException(
                        "token names a business that does not exist: " + tenant.businessId()));
    }
}
