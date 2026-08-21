package com.slotflow.staff;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.slotflow.business.Business;
import java.time.ZoneId;
import java.util.Currency;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The invited-user lifecycle, and the email normalisation the unique index depends on.
 */
class UserTest {

    private static final UUID BUSINESS_ID = UUID.randomUUID();

    @Test
    @DisplayName("an email is lower-cased and trimmed, because the unique index is the case check")
    void normalisesEmail() {
        User user = User.owner(BUSINESS_ID, "  Dana.Okoye@Example.TEST ", "Dana Okoye", "hash");

        // Stored lower-cased so a plain unique index is the case-insensitive check, with no
        // functional index and no CITEXT dependency. A missed normalisation would be two accounts
        // for one person, or an insert refused by app_user_email_lower_chk.
        assertThat(user.getEmail()).isEqualTo("dana.okoye@example.test");
    }

    @Test
    @DisplayName("an owner is active and can log in immediately")
    void ownerIsReadyToUse() {
        User owner = User.owner(BUSINESS_ID, "dana@example.test", "Dana Okoye", "hash");

        assertThat(owner.getRole()).isEqualTo(Role.OWNER);
        assertThat(owner.isOwner()).isTrue();
        assertThat(owner.isActive()).isTrue();
        assertThat(owner.canLogIn()).isTrue();
    }

    @Test
    @DisplayName("an invited user cannot log in until they accept")
    void invitedUserCannotLogIn() {
        User invited = User.invited(BUSINESS_ID, "sam@example.test", "Sam Ferreira", Role.STAFF);

        assertThat(invited.isActive()).isFalse();
        assertThat(invited.hasPassword()).isFalse();
        assertThat(invited.canLogIn()).isFalse();
    }

    @Test
    @DisplayName("accepting sets the password and activates in one step, so there is no gap")
    void acceptingActivates() {
        User invited = User.invited(BUSINESS_ID, "sam@example.test", "Sam F", Role.STAFF);

        invited.acceptInvitation("Sam Ferreira", "bcrypt-hash");

        // One method rather than two, so there is no window in which a user is active without a
        // password — which would be an account anyone could log into.
        assertThat(invited.isActive()).isTrue();
        assertThat(invited.hasPassword()).isTrue();
        assertThat(invited.getFullName())
                .as("the name the invitee typed beats the one the owner guessed")
                .isEqualTo("Sam Ferreira");
    }

    @Test
    @DisplayName("accepting twice is refused, which is what plan 06 turns into a 410")
    void acceptingTwiceIsRefused() {
        User invited = User.invited(BUSINESS_ID, "sam@example.test", "Sam F", Role.STAFF);
        invited.acceptInvitation("Sam Ferreira", "bcrypt-hash");

        assertThatThrownBy(() -> invited.acceptInvitation("Someone Else", "another-hash"))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("accepting cannot reactivate somebody who was deactivated")
    void acceptingCannotUndoADeactivation() {
        User staff = User.invited(BUSINESS_ID, "sam@example.test", "Sam F", Role.STAFF);
        staff.acceptInvitation("Sam Ferreira", "bcrypt-hash");
        staff.deactivate();

        // Inactive, so the "already active" guard lets this through — and the password hash is
        // still there, so accepting would overwrite it and switch the account back on. That would
        // make any invitation minted for this row a self-service reactivation, which is the one
        // thing deactivation exists to prevent.
        assertThatThrownBy(() -> staff.acceptInvitation("Sam Ferreira", "a-hash-of-my-own"))
                .isInstanceOf(IllegalStateException.class);
        assertThat(staff.isActive()).isFalse();
        assertThat(staff.getPasswordHash()).isEqualTo("bcrypt-hash");
    }

    @Test
    @DisplayName("a deactivated owner can no longer manage their business")
    void deactivationRemovesManagementRights() {
        Business business = business();
        User owner = User.owner(business.getId(), "dana@example.test", "Dana Okoye", "hash");
        assertThat(owner.canManage(business)).isTrue();

        owner.deactivate();

        assertThat(owner.canManage(business)).isFalse();
        assertThat(owner.canLogIn()).isFalse();
    }

    @Test
    @DisplayName("an owner of another tenant cannot manage this one, whatever their role says")
    void crossTenantOwnersCannotManage() {
        Business other = business();
        User owner = User.owner(UUID.randomUUID(), "dana@example.test", "Dana Okoye", "hash");

        // The domain-level half of tenant isolation, underneath the guard in plan 06. Being an
        // owner is not a global privilege.
        assertThat(owner.canManage(other)).isFalse();
    }

    @Test
    @DisplayName("staff cannot manage a business even when it is their own")
    void staffCannotManage() {
        Business business = business();
        User staff = User.invited(business.getId(), "sam@example.test", "Sam", Role.STAFF);
        staff.acceptInvitation("Sam Ferreira", "hash");

        assertThat(staff.canManage(business)).isFalse();
    }

    @Test
    @DisplayName("deactivating a staff member leaves everything except their access alone")
    void deactivationIsNotDeletion() {
        User staff = User.invited(BUSINESS_ID, "sam@example.test", "Sam Ferreira", Role.STAFF);
        staff.acceptInvitation("Sam Ferreira", "hash");

        staff.deactivate();

        // Their future bookings stay intact and visible in the admin calendar (plan 06). Silently
        // dropping a real customer's appointment is worse than an awkward badge on a screen.
        assertThat(staff.isActive()).isFalse();
        assertThat(staff.hasPassword()).isTrue();
        assertThat(staff.getFullName()).isEqualTo("Sam Ferreira");
    }

    @Test
    @DisplayName("a blank email or name is refused rather than stored")
    void refusesBlankValues() {
        assertThatThrownBy(() -> User.owner(BUSINESS_ID, "  ", "Dana", "hash"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> User.owner(BUSINESS_ID, "dana@example.test", "", "hash"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> User.owner(BUSINESS_ID, "dana@example.test", "Dana", " "))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private static Business business() {
        return new Business("dana-clinic", "Dana Clinic",
                ZoneId.of("Europe/Paris"), Currency.getInstance("EUR"));
    }
}
