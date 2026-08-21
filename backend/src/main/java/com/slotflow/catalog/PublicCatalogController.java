package com.slotflow.catalog;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * Step 1 of the booking flow: "pick a service".
 *
 * <p>{@link PublicServiceResponse} is the boundary — an id, a name, a description, a duration and a
 * price. No buffers, because the customer is booking sixty minutes and the calendar's eighty are
 * none of their business, and no {@code active} flag, because an inactive service is simply not
 * here.
 *
 * <p>{@code @SecurityRequirements} with no arguments opts this operation out of the document-wide
 * bearer requirement, so Swagger UI does not draw a padlock on the one page a customer reaches
 * without an account.
 */
@RestController
@Tag(name = "Public booking", description = "Unauthenticated endpoints the booking page calls")
@SecurityRequirements
public class PublicCatalogController {

    private final PublicCatalogService publicCatalog;

    public PublicCatalogController(PublicCatalogService publicCatalog) {
        this.publicCatalog = publicCatalog;
    }

    @GetMapping("/api/public/businesses/{slug}/services")
    @Operation(summary = "What can be booked",
            description = "Active services for a business, cheapest details only. Deactivated "
                    + "services disappear from this list immediately.")
    public List<PublicServiceResponse> services(@PathVariable String slug) {
        return publicCatalog.activeServices(slug);
    }
}
