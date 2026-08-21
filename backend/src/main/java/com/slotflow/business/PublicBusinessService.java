package com.slotflow.business;

import com.slotflow.availability.OpeningHours;
import com.slotflow.availability.WorkingHoursRepository;
import com.slotflow.catalog.PublicCatalogService;
import com.slotflow.staff.User;
import com.slotflow.staff.UserRepository;
import jakarta.persistence.EntityNotFoundException;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The public business page, assembled from four reads.
 *
 * <p>One endpoint rather than three, because the landing page cannot render anything useful from a
 * subset: the name and the timezone frame it, the services are the page, and the opening hours are
 * what tells a visitor whether to bother today. Three round trips to draw one screen is the shape
 * that gets cached badly later.
 *
 * <p><b>The hours are derived, not stored</b> (D5). Working hours belong to people, so a business has
 * none of its own; this takes the union across the staff a customer could actually book — active
 * ones — and hands it to {@link OpeningHours#derive}. A deactivated colleague's hours therefore stop
 * showing on the landing page at the same moment they stop being bookable, which is the whole point
 * of using the active set rather than every row in the table.
 *
 * <p>Not cached. Plan 07 suggests a per-business minute of caching "if it is a visible cost — but
 * measure before adding cache", and the cost is four indexed reads against tables that hold tens of
 * rows per tenant. A cache here would buy nothing measurable and would owe an invalidation on every
 * catalog and working-hours write.
 */
@Service
public class PublicBusinessService {

    private final BusinessRepository businesses;
    private final UserRepository users;
    private final WorkingHoursRepository workingHours;
    private final PublicCatalogService publicCatalog;

    public PublicBusinessService(BusinessRepository businesses, UserRepository users,
                                WorkingHoursRepository workingHours,
                                PublicCatalogService publicCatalog) {
        this.businesses = businesses;
        this.users = users;
        this.workingHours = workingHours;
        this.publicCatalog = publicCatalog;
    }

    @Transactional(readOnly = true)
    public PublicBusinessResponse page(String slug) {
        // findByPublicSlug, not findBySlug: what arrives in the path is whatever a customer typed
        // or a card printed, and the stored value is lower case.
        Business business = businesses.findByPublicSlug(slug)
                .orElseThrow(() -> new EntityNotFoundException("no business with slug " + slug));

        return new PublicBusinessResponse(
                business.getSlug(),
                business.getName(),
                business.getTimezone().getId(),
                business.getCurrency().getCurrencyCode(),
                // requiresDeposit(), not the raw flag: a percentage of zero is no deposit whatever
                // the checkbox says.
                business.requiresDeposit(),
                business.getDepositPercent(),
                openingHoursOf(business.getId()),
                publicCatalog.activeServices(business.getId()));
    }

    private List<OpeningHours> openingHoursOf(UUID businessId) {
        List<UUID> bookableStaff = users.findByBusinessIdAndActiveTrue(businessId).stream()
                .map(User::getId)
                .toList();
        // One query for the whole team, guarded against an empty in-list by the repository: a
        // business whose staff are all deactivated would otherwise send a query that can only
        // return nothing on every visit to its landing page.
        return OpeningHours.derive(workingHours.findForStaff(bookableStaff));
    }
}
