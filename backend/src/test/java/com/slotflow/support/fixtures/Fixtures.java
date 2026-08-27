package com.slotflow.support.fixtures;

import java.util.UUID;

/**
 * One static import for every fixture builder in the suite:
 *
 * <pre>{@code
 * import static com.slotflow.support.fixtures.Fixtures.*;
 *
 * Business clinic = aBusiness().withTimezone("Europe/Paris").build();
 * ServiceOffering massage = aService().forBusiness(clinic)
 *         .withDuration(60).withBuffers(10, 10).build();
 * }</pre>
 *
 * <p>Every builder starts from a valid, boring default and lets a test override only what the test
 * is actually about. That is the whole point: a test that says
 * {@code aService().withBuffers(10, 10)} is visibly a test about buffers, whereas the same setup
 * spelled out longhand buries the one interesting number in eight uninteresting ones.
 *
 * <p>Plan 14 calls this sunk cost with compounding return, and waves 3–8 assume it exists. Adding a
 * builder here is cheaper than the third test that would have set the same six fields by hand.
 */
public final class Fixtures {

    private Fixtures() {}

    public static BusinessBuilder aBusiness() {
        return new BusinessBuilder();
    }

    public static BookingPolicyBuilder aPolicy() {
        return new BookingPolicyBuilder();
    }

    public static UserBuilder anOwner() {
        return UserBuilder.owner();
    }

    public static UserBuilder aStaffMember() {
        return UserBuilder.staff();
    }

    public static ServiceOfferingBuilder aService() {
        return new ServiceOfferingBuilder();
    }

    public static WorkingHoursBuilder workingHours() {
        return new WorkingHoursBuilder();
    }

    public static AvailabilityOverrideBuilder anOverride() {
        return new AvailabilityOverrideBuilder();
    }

    public static BookingBuilder aBooking() {
        return new BookingBuilder();
    }

    /**
     * A short, unique suffix for the columns the schema makes globally unique — slugs and email
     * addresses. Without it two fixtures built with default values collide, and the failure reads
     * as a constraint violation somewhere unrelated to the test that caused it.
     */
    static String uniqueSuffix() {
        return UUID.randomUUID().toString().substring(0, 8);
    }
}
