package com.slotflow.support.fixtures;

import com.slotflow.business.Business;
import com.slotflow.staff.Role;
import com.slotflow.staff.User;
import java.util.UUID;

/**
 * A user. Reached through {@code anOwner()} or {@code aStaffMember()} rather than a bare
 * {@code aUser()}, because the role and the active flag move together: an owner exists because
 * they registered, a staff member exists because they were invited and has to accept before they
 * can do anything.
 *
 * <p>Emails are unique per built instance (D13 makes them globally unique), so two default fixtures
 * in one test do not collide on the index.
 */
public final class UserBuilder {

    private UUID businessId = UUID.randomUUID();
    private String email = "person-" + Fixtures.uniqueSuffix() + "@example.test";
    private String fullName;
    private Role role;
    private String passwordHash = "$2a$10$fixture.hash.not.a.real.bcrypt.value.at.all";
    private boolean accepted;

    private UserBuilder(Role role, String fullName, boolean accepted) {
        this.role = role;
        this.fullName = fullName;
        this.accepted = accepted;
    }

    static UserBuilder owner() {
        return new UserBuilder(Role.OWNER, "Dana Okoye", true);
    }

    static UserBuilder staff() {
        return new UserBuilder(Role.STAFF, "Sam Ferreira", true);
    }

    public UserBuilder forBusiness(Business business) {
        return forBusiness(business.getId());
    }

    public UserBuilder forBusiness(UUID businessId) {
        this.businessId = businessId;
        return this;
    }

    public UserBuilder withEmail(String email) {
        this.email = email;
        return this;
    }

    public UserBuilder withName(String fullName) {
        this.fullName = fullName;
        return this;
    }

    public UserBuilder withRole(Role role) {
        this.role = role;
        return this;
    }

    public UserBuilder withPasswordHash(String passwordHash) {
        this.passwordHash = passwordHash;
        return this;
    }

    /** Invited but not yet accepted: inactive, no password, cannot log in. */
    public UserBuilder invited() {
        this.accepted = false;
        return this;
    }

    public User build() {
        if (!accepted) {
            return User.invited(businessId, email, fullName, role);
        }
        if (role == Role.OWNER) {
            return User.owner(businessId, email, fullName, passwordHash);
        }
        User staff = User.invited(businessId, email, fullName, role);
        staff.acceptInvitation(fullName, passwordHash);
        return staff;
    }
}
