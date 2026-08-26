package com.slotflow.support;

import static org.assertj.core.api.Assertions.assertThat;

import com.slotflow.availability.domain.AvailabilityEngine;
import com.slotflow.booking.Booking;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The two package names the JaCoCo gate is written against, asserted so that a rename cannot
 * silently switch the gate off.
 *
 * <p>Plan 14 chose deliberately not to set a project-wide coverage threshold: a global number is met
 * by testing getters, and this build would rather fail on the availability engine than on a DTO. The
 * cost of that choice is that the gate names its two packages as strings, in {@code pom.xml}:
 *
 * <pre>{@code
 * <element>PACKAGE</element>
 * <includes>
 *   <include>com.slotflow.availability.domain</include>
 *   <include>com.slotflow.booking</include>
 * </includes>
 * }</pre>
 *
 * <p>JaCoCo evaluates such a rule once per <em>matching</em> package, and a package that matches
 * nothing is not a failure — it is simply not checked. So moving the engine into
 * {@code com.slotflow.scheduling}, or splitting {@code booking} into subpackages, would leave a
 * green build with no coverage gate on the two things worth gating, and nothing in the output would
 * say so. This test is what makes that rename a compile error and a red test instead.
 *
 * <p>Which is also why the two classes are imported rather than named as strings: an import that no
 * longer resolves fails at compilation, before anyone has to read an assertion message.
 */
class CoverageGateTest {

    @Test
    @DisplayName("the availability engine still lives in the package the gate checks")
    void theEnginePackageIsUnchanged() {
        assertThat(AvailabilityEngine.class.getPackageName())
                .as("update the jacoco check rule in pom.xml if this package moves")
                .isEqualTo("com.slotflow.availability.domain");
    }

    @Test
    @DisplayName("the booking package still lives where the gate checks, with no subpackages")
    void theBookingPackageIsUnchanged() {
        assertThat(Booking.class.getPackageName())
                .as("update the jacoco check rule in pom.xml if this package moves")
                .isEqualTo("com.slotflow.booking");
    }
}
