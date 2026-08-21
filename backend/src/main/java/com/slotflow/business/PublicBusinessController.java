package com.slotflow.business;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * The booking page's landing request, and the only endpoint in the API that answers "what is this
 * business?" to somebody with no account.
 *
 * <p>Kept in the {@code business} package rather than with the catalog, even though plan 07 delivers
 * it: the resource is the business, the services are one member of it, and packaging by feature is
 * what keeps the public and the admin views of a business in the same place — where the next person
 * to add a setting will see both.
 */
@RestController
@Tag(name = "Public booking", description = "Unauthenticated endpoints the booking page calls")
@SecurityRequirements
public class PublicBusinessController {

    private final PublicBusinessService publicBusiness;

    public PublicBusinessController(PublicBusinessService publicBusiness) {
        this.publicBusiness = publicBusiness;
    }

    @GetMapping("/api/public/businesses/{slug}")
    @Operation(summary = "The booking page",
            description = "Name, timezone, currency, deposit rules, the active catalog, and the "
                    + "opening hours derived from the union of active staff working hours (D5). "
                    + "The slug is matched case-insensitively.")
    public PublicBusinessResponse page(@PathVariable String slug) {
        return publicBusiness.page(slug);
    }
}
