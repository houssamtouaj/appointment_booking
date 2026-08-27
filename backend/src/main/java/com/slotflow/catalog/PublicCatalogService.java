package com.slotflow.catalog;

import com.slotflow.business.Business;
import com.slotflow.business.BusinessRepository;
import jakarta.persistence.EntityNotFoundException;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The catalog a customer sees: active services only, no authentication, no buffers.
 *
 * <p>Two callers share it — the standalone {@code /services} list and the business page, which
 * embeds the same list — so "active only" and the response shape are decided once. A second copy of
 * that filter is how a deactivated service comes to be hidden on one screen and still offered on the
 * other.
 *
 * <p>Never paginated. The admin grid is, because it shows the archive too and a busy tenant
 * accumulates one; a landing page wants every service the business sells, and a business with two
 * hundred bookable services does not exist.
 */
@Service
public class PublicCatalogService {

    private final BusinessRepository businesses;
    private final ServiceOfferingRepository services;
    private final CatalogMapper mapper;

    public PublicCatalogService(BusinessRepository businesses,
            ServiceOfferingRepository services, CatalogMapper mapper) {
        this.businesses = businesses;
        this.services = services;
        this.mapper = mapper;
    }

    /**
     * The tenant comes from the slug in the path, because there is no token to read it from.
     *
     * <p>Resolved through {@code findByPublicSlug}, which folds the case the way registration
     * promised it would: the slug is on the business's printed card, and a customer who capitalises
     * it must not be told the shop does not exist.
     */
    @Transactional(readOnly = true)
    public List<PublicServiceResponse> activeServices(String slug) {
        Business business = businesses.findByPublicSlug(slug)
                .orElseThrow(() -> new EntityNotFoundException("no business with slug " + slug));
        return activeServices(business.getId());
    }

    @Transactional(readOnly = true)
    public List<PublicServiceResponse> activeServices(UUID businessId) {
        return services.findByBusinessIdAndActiveTrue(businessId).stream()
                // Stable order, so a customer refreshing the page does not see the list shuffle.
                .sorted(Comparator.comparing(ServiceOffering::getName, String.CASE_INSENSITIVE_ORDER)
                        .thenComparing(ServiceOffering::getId))
                .map(mapper::toPublicResponse)
                .toList();
    }
}
