package com.slotflow.demo;

import com.slotflow.business.Business;
import com.slotflow.support.ApiIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.test.context.ActiveProfiles;

/**
 * Base class for the two tests that need the {@code demo} profile switched on.
 *
 * <h2>This forks the context cache, and that is why there is a base class</h2>
 * {@link ApiIntegrationTest} goes to some trouble to keep every integration test sharing one
 * application context, and {@code @ActiveProfiles} breaks that by definition: a different set of
 * active profiles is a different context key. There is no way around it — the seeder and the
 * demo-login route only exist under the profile, so testing them without activating it would test
 * nothing — so the cost is paid exactly once, here, by both subclasses.
 *
 * <h2>Every test re-seeds from scratch</h2>
 * The seeder has already run once, at context startup, and that run is not what these tests assert
 * on. Testcontainers reuse means the database can carry a demo business left by an earlier build,
 * seeded by an earlier version of this class; asserting on it would be asserting on history. So
 * {@link #reseed()} deletes the demo tenant and runs the seeder again — which makes every
 * assertion below a statement about the code in the working tree, and makes the delete-then-seed
 * cycle itself part of what is tested.
 *
 * <p>The delete relies on the schema: {@code business} cascades to every table that references it,
 * so one statement removes the users, services, hours, overrides and forty bookings with it.
 */
@ActiveProfiles("demo")
abstract class DemoProfileTest extends ApiIntegrationTest {

    @Autowired
    protected DemoDataSeeder seeder;

    @BeforeEach
    void reseed() {
        businesses.findBySlug(DemoBusiness.SLUG).ifPresent(businesses::delete);
        // Not @Transactional, so the delete has committed by the time the seeder looks for the
        // slug. Were it enclosed in the test's own transaction, existsBySlug would still see the
        // row and the seeder would correctly decline to do anything.
        seeder.run(new DefaultApplicationArguments());
    }

    protected Business demoBusiness() {
        return businesses.findBySlug(DemoBusiness.SLUG).orElseThrow(
                () -> new AssertionError("the seeder did not create " + DemoBusiness.SLUG));
    }
}
