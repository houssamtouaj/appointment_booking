package com.slotflow.availability;

import com.slotflow.staff.User;
import com.slotflow.support.CrossTenantTestBase;
import com.slotflow.support.fixtures.Fixtures;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;

/**
 * The availability-configuration half of "no request can reach another tenant's data".
 *
 * <p>Five endpoints, ten generated tests. What is <em>not</em> here is {@code /api/business} and
 * {@code /api/policy}: neither path carries an id, so the business under edit is always the one in
 * the token and there is no cross-tenant request to express. That is asserted where it can be — a
 * positive test in {@code BusinessSettingsIT} that a caller reads their own policy and not the one
 * the other tenant just changed.
 *
 * <p>Each tenant gets a second staff member and two overrides, because every case needs a control
 * that succeeds inside my own business and two of the cases are deletes.
 */
class AvailabilityConfigCrossTenantIT extends CrossTenantTestBase {

    @Autowired
    private AvailabilityOverrideRepository overrides;

    private User myColleague;
    private User theirColleague;
    private UUID myOverride;
    private UUID myOtherOverride;
    private UUID theirOverride;

    @BeforeEach
    void createStaffAndOverridesInBothTenants() {
        myColleague = aStaffMemberOf(mine);
        theirColleague = aStaffMemberOf(theirs);
        myOverride = anOverrideFor(myColleague);
        myOtherOverride = anOverrideFor(myColleague);
        theirOverride = anOverrideFor(theirColleague);
    }

    @Override
    protected List<CrossTenantCase> crossTenantCases() {
        String week = """
                {"ranges": [{"dayOfWeek": "MONDAY", "startTime": "09:00", "endTime": "17:00"}]}
                """;
        String dayOff = """
                {"date": "2026-09-01", "type": "BLOCKED"}
                """;
        return List.of(
                // A read of somebody else's template: absent, not forbidden.
                CrossTenantCase.read(hours(theirColleague), hours(myColleague)),
                CrossTenantCase.write(HttpMethod.PUT, hours(theirColleague), hours(myColleague),
                        week),
                CrossTenantCase.write(HttpMethod.POST,
                        exceptions(theirColleague), exceptions(myColleague), dayOff),
                CrossTenantCase.write(HttpMethod.DELETE,
                        exceptions(theirColleague) + "/" + theirOverride,
                        exceptions(myColleague) + "/" + myOverride,
                        null),
                // The owner-only path onto any row in the tenant, which is the delete button on the
                // merged calendar.
                CrossTenantCase.write(HttpMethod.DELETE,
                        "/api/exceptions/" + theirOverride,
                        "/api/exceptions/" + myOtherOverride,
                        null));
    }

    private UUID anOverrideFor(User staff) {
        return overrides.save(Fixtures.anOverride()
                .forBusiness(staff.getBusinessId())
                .forStaff(staff)
                .on("2026-09-15")
                .wholeDay()
                .build()).getId();
    }

    private static String hours(User staff) {
        return "/api/staff/" + staff.getId() + "/working-hours";
    }

    private static String exceptions(User staff) {
        return "/api/staff/" + staff.getId() + "/exceptions";
    }
}
