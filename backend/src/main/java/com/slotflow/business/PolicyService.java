package com.slotflow.business;

import com.slotflow.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The booking policy: read it, replace it.
 *
 * <p>The policy's primary key <em>is</em> its business id, so {@code findById(businessId)} is already
 * the tenant-scoped lookup and there is no cross-tenant read to guard against — the id never comes
 * from the request. A missing row is a broken invariant rather than a 404: registration creates the
 * policy in the same transaction as the business, and the foreign key cascades.
 *
 * <p>Nothing here validates a duration against {@code slotGranularityMinutes}, and that is the point
 * plan 07 and plan 08 both make from their own side. Granularity governs where a slot may
 * <em>start</em>; a 45-minute service on a 15-minute grid is ordinary. Tying the two together would
 * mean a business could not change its grid without its catalog becoming invalid.
 */
@Service
public class PolicyService {

    private static final Logger log = LoggerFactory.getLogger(PolicyService.class);

    private final BookingPolicyRepository policies;
    private final TenantContext tenant;

    public PolicyService(BookingPolicyRepository policies, TenantContext tenant) {
        this.policies = policies;
        this.tenant = tenant;
    }

    @Transactional(readOnly = true)
    public PolicyResponse get() {
        return response(policy());
    }

    /**
     * A full replace of the four numbers.
     *
     * <p>Every value has already been range-checked by {@link PolicyRequest} — narrower than the
     * schema's own constraints, because a check constraint is a floor and a 422 naming the field is
     * an answer. The entity's setters then refuse anything that got through, which is what keeps a
     * future caller that does not go past bean validation honest.
     */
    @Transactional
    public PolicyResponse replace(PolicyRequest request) {
        BookingPolicy policy = policy();
        policy.setMinLeadTimeHours(request.minLeadTimeHours());
        policy.setMaxAdvanceDays(request.maxAdvanceDays());
        policy.setCancellationCutoffHours(request.cancellationCutoffHours());
        policy.setSlotGranularityMinutes(request.slotGranularityMinutes());

        log.info("Booking policy for business {} set to lead {}h, advance {}d, cutoff {}h, grid {}m",
                policy.getBusinessId(), policy.getMinLeadTimeHours(), policy.getMaxAdvanceDays(),
                policy.getCancellationCutoffHours(), policy.getSlotGranularityMinutes());
        // saveAndFlush, not save: @LastModifiedDate is stamped by the auditing listener on
        // @PreUpdate, which runs at flush. A plain save() on an already-managed entity is a no-op
        // merge, so the response would carry the updatedAt from before this very write — and a
        // client caching it to detect policy drift would see a timestamp older than its own change.
        return response(policies.saveAndFlush(policy));
    }

    private BookingPolicy policy() {
        return policies.findById(tenant.businessId())
                .orElseThrow(() -> new IllegalStateException(
                        "business " + tenant.businessId() + " has no booking policy"));
    }

    private static PolicyResponse response(BookingPolicy policy) {
        return new PolicyResponse(policy.getMinLeadTimeHours(), policy.getMaxAdvanceDays(),
                policy.getCancellationCutoffHours(), policy.getSlotGranularityMinutes(),
                policy.getUpdatedAt());
    }
}
