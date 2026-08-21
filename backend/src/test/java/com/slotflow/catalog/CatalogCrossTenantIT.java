package com.slotflow.catalog;

import com.slotflow.support.CrossTenantTestBase;
import com.slotflow.support.fixtures.Fixtures;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;

/**
 * The catalog's half of "no request can reach another tenant's data": three endpoints, six
 * generated tests.
 *
 * <p>A service in each tenant, because every case needs a paired control — the same call inside my
 * own business, which must succeed. Without it a typo in a path would answer 404 for everyone and
 * this class would pass forever while asserting nothing.
 *
 * <p>{@code DELETE} is in the list even though it is a soft delete. It is still a write, so a
 * foreign id has to be a 403 rather than a 404, and it is still the endpoint that would let a
 * competitor empty a booking page.
 *
 * <p>The other way into another tenant is the assignment set — my own service, their staff member —
 * and it is not here because it is refused on the body rather than on the resource:
 * {@code 422 STAFF_NOT_IN_BUSINESS}, asserted in {@link CatalogIT}, while every write case in this
 * harness expects {@code ACCESS_DENIED}.
 */
class CatalogCrossTenantIT extends CrossTenantTestBase {

    @Autowired
    private ServiceOfferingRepository services;

    private UUID myService;
    private UUID theirService;

    @BeforeEach
    void createAServiceInBothTenants() {
        myService = services.save(Fixtures.aService().forBusiness(mine.business()).build()).getId();
        theirService = services.save(
                Fixtures.aService().forBusiness(theirs.business()).build()).getId();
    }

    @Override
    protected List<CrossTenantCase> crossTenantCases() {
        return List.of(
                CrossTenantCase.read("/api/services/" + theirService,
                        "/api/services/" + myService),
                CrossTenantCase.write(HttpMethod.PATCH,
                        "/api/services/" + theirService,
                        "/api/services/" + myService,
                        """
                        {"priceCents": 1}
                        """),
                CrossTenantCase.write(HttpMethod.DELETE,
                        "/api/services/" + theirService,
                        "/api/services/" + myService,
                        null));
    }
}
