package com.slotflow.staff;

import com.slotflow.business.Business;
import com.slotflow.common.jpa.AbstractMutableEntity;
import com.slotflow.tenant.TenantOwned;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.util.Locale;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * A person who works for a business: the owner who registered it, or a staff member they invited.
 *
 * <p>Not customers. Every booking is a guest booking (D1), so this table only ever holds people
 * who can log in.
 *
 * <p>The table is {@code app_user} because {@code user} is reserved in Postgres. Emails are
 * globally unique (D13) and stored lower-cased, which is what makes the plain unique index a
 * case-insensitive check with no functional index and no CITEXT dependency — so every write path
 * has to normalise, and that is why there is no setter for the field.
 *
 * <p>An invited staff member exists here <em>before</em> they accept: inactive, with a null
 * password hash. That is what makes an invitation listable, resendable and revocable rather than
 * a link floating in an inbox (plan 06).
 */
@Entity
@Table(name = "app_user")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class User extends AbstractMutableEntity implements TenantOwned {

    /** NOT NULL by D1: a user always belongs to exactly one business. */
    @Column(nullable = false, updatable = false)
    private UUID businessId;

    @Column(nullable = false, length = 320, unique = true)
    private String email;

    /** BCrypt, and null until an invited staff member chooses one. Never leaves this package. */
    @Column(length = 100)
    private String passwordHash;

    @Column(nullable = false, length = 120)
    private String fullName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Role role;

    @Column(nullable = false)
    private boolean active;

    private User(UUID businessId, String email, String fullName, Role role,
                 String passwordHash, boolean active) {
        this.businessId = requireNotNull(businessId, "businessId");
        this.email = normaliseEmail(email);
        this.fullName = requireText(fullName, "fullName");
        this.role = requireNotNull(role, "role");
        this.passwordHash = passwordHash;
        this.active = active;
    }

    /** The first user of a business, created in the same transaction as the business (plan 05). */
    public static User owner(UUID businessId, String email, String fullName, String passwordHash) {
        return new User(businessId, email, fullName, Role.OWNER,
                requireText(passwordHash, "passwordHash"), true);
    }

    /**
     * The row an invitation points at: no password, and unable to log in until
     * {@link #acceptInvitation} runs. The role is a parameter because an owner may invite a
     * co-owner.
     */
    public static User invited(UUID businessId, String email, String fullName, Role role) {
        return new User(businessId, email, fullName, role, null, false);
    }

    // ---------------------------------------------------------------------------------
    //  behaviour
    // ---------------------------------------------------------------------------------

    public boolean isOwner() {
        return role == Role.OWNER;
    }

    /**
     * Whether this user may administer that business. Both halves matter: a deactivated owner is
     * refused, and so is an owner of a <em>different</em> tenant — which is the check that stops
     * cross-tenant writes at the domain level, underneath the guard in plan 06.
     */
    public boolean canManage(Business business) {
        return active && isOwner() && businessId.equals(business.getId());
    }

    /** False for an invited user who has not accepted yet, which is also why they cannot log in. */
    public boolean hasPassword() {
        return passwordHash != null;
    }

    public boolean canLogIn() {
        return active && hasPassword();
    }

    /**
     * Consuming an invitation: the name the invitee typed wins over the one the owner guessed,
     * and setting the password is what activates the account. One method, so there is no window
     * in which a user is active without a password.
     */
    public void acceptInvitation(String fullName, String passwordHash) {
        if (active) {
            throw new IllegalStateException("user is already active");
        }
        this.fullName = requireText(fullName, "fullName");
        this.passwordHash = requireText(passwordHash, "passwordHash");
        this.active = true;
    }

    public void changePassword(String passwordHash) {
        this.passwordHash = requireText(passwordHash, "passwordHash");
    }

    public void rename(String fullName) {
        this.fullName = requireText(fullName, "fullName");
    }

    public void changeRole(Role role) {
        this.role = requireNotNull(role, "role");
    }

    /**
     * Blocks login and hides the user from the public staff list, and deliberately leaves their
     * future bookings alone (plan 06). Silently deleting or reassigning a real customer's
     * appointment is worse than an awkward state on an admin screen.
     */
    public void deactivate() {
        this.active = false;
    }

    public void activate() {
        this.active = true;
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    /**
     * Lower-cased and trimmed on every path in. The {@code app_user_email_lower_chk} constraint
     * turns a missed call here into a failed insert rather than a duplicate account that differs
     * only by capitalisation.
     */
    static String normaliseEmail(String email) {
        return requireText(email, "email").trim().toLowerCase(Locale.ROOT);
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value.trim();
    }

    private static <T> T requireNotNull(T value, String field) {
        if (value == null) {
            throw new IllegalArgumentException(field + " must not be null");
        }
        return value;
    }
}
