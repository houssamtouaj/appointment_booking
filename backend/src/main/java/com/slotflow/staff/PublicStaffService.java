package com.slotflow.staff;

import com.slotflow.business.Business;
import com.slotflow.business.BusinessRepository;
import com.slotflow.catalog.StaffService;
import com.slotflow.catalog.StaffServiceRepository;
import jakarta.persistence.EntityNotFoundException;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * D9: who a customer can book with, for the booking page, with no authentication at all.
 *
 * <p>The tenant is resolved from the slug in the path rather than from a token, because there is no
 * token — and that is exactly why this class returns {@link PublicStaffResponse} and never touches
 * {@link StaffResponse}. The rule for a public endpoint is that the DTO is the boundary: id and
 * display name, and no field that could grow into a PII leak later.
 *
 * <p>The slug arrives from a URL a human may have typed, so it is resolved through
 * {@code BusinessRepository.findByPublicSlug}, which folds the case the way {@code register} does
 * on the way in. An exact match here answers 404 for a business whose own printed card says
 * "Dana-Clinic".
 *
 * <p>Two filters, both of which matter:
 *
 * <ul>
 *   <li><b>Active only.</b> A deactivated colleague disappears from the booking page immediately,
 *       which is half of what deactivation means (the other half is that their existing bookings
 *       stay put).</li>
 *   <li><b>{@code ?serviceId=} intersects with the business's own team.</b> A service id from
 *       another tenant therefore yields an empty list rather than that tenant's staff — the
 *       intersection is the isolation, so there is no separate ownership check to forget.</li>
 * </ul>
 */
@Service
public class PublicStaffService {

    private final BusinessRepository businesses;
    private final UserRepository users;
    private final StaffServiceRepository assignments;
    private final StaffMapper mapper;

    public PublicStaffService(BusinessRepository businesses, UserRepository users,
                              StaffServiceRepository assignments, StaffMapper mapper) {
        this.businesses = businesses;
        this.users = users;
        this.assignments = assignments;
        this.mapper = mapper;
    }

    @Transactional(readOnly = true)
    public List<PublicStaffResponse> bookableStaff(String slug, UUID serviceId) {
        // findByPublicSlug, not findBySlug: the stored value is lower case and what arrives in the
        // path is whatever a customer typed or a card printed. The normalisation lives in the
        // repository so the public endpoints plans 07-10 add inherit it instead of copying it.
        Business business = businesses.findByPublicSlug(slug)
                .orElseThrow(() -> new EntityNotFoundException("no business with slug " + slug));

        List<User> active = users.findByBusinessIdAndActiveTrue(business.getId());
        if (serviceId != null) {
            Set<UUID> performers = assignments.findByServiceId(serviceId).stream()
                    .map(StaffService::getStaffId)
                    .collect(Collectors.toSet());
            active = active.stream()
                    .filter(user -> performers.contains(user.getId()))
                    .toList();
        }

        return active.stream()
                // Stable order, so a customer refreshing the page does not see the list shuffle.
                .sorted(Comparator.comparing(User::getFullName, String.CASE_INSENSITIVE_ORDER))
                .map(mapper::toPublicResponse)
                .toList();
    }
}
