package com.slotflow.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * The normalisation in a three-field record, which is the last place anybody looks for a bug and
 * the first place one matters: a booking's guest email is what the confirmation, the reminder and
 * the manage link are all addressed to, and there is no customer account to correct it from (D1).
 */
class GuestContactTest {

    @Test
    @DisplayName("the email is lower-cased and trimmed, so two spellings are one customer")
    void theEmailIsNormalised() {
        GuestContact guest = new GuestContact("  Léa Fontaine ", "  LEA@Example.COM  ", null);

        // Lower-cased for the same reason app_user.email is: the guest-booking rate limit (D12) is
        // keyed on this string, and "Lea@" versus "lea@" would be two budgets for one person.
        assertThat(guest.email()).isEqualTo("lea@example.com");
        assertThat(guest.name()).isEqualTo("Léa Fontaine");
    }

    @ParameterizedTest(name = "phone \"{0}\" becomes null")
    @NullAndEmptySource
    @ValueSource(strings = {"   ", "\t"})
    @DisplayName("a blank phone number is stored as absent, not as an empty string")
    void aBlankPhoneIsNull(String phone) {
        // An empty string in the column would serialise as `"phone": ""` and render as a phone
        // number that is there and unusable, which is worse than the field being absent.
        assertThat(new GuestContact("Léa", "lea@example.com", phone).phone()).isNull();
    }

    @Test
    @DisplayName("a phone number that is present is trimmed and kept")
    void aRealPhoneSurvives() {
        assertThat(new GuestContact("Léa", "lea@example.com", " +33 6 12 34 56 78 ").phone())
                .isEqualTo("+33 6 12 34 56 78");
    }

    @ParameterizedTest(name = "name \"{0}\"")
    @NullAndEmptySource
    @ValueSource(strings = {"  "})
    @DisplayName("a booking with nobody's name on it is refused, and the message says which field")
    void theNameIsRequired(String name) {
        assertThatThrownBy(() -> new GuestContact(name, "lea@example.com", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("guest name");
    }

    @ParameterizedTest(name = "email \"{0}\"")
    @NullAndEmptySource
    @ValueSource(strings = {"  "})
    @DisplayName("a booking with no address is refused: there is nowhere to send the manage link")
    void theEmailIsRequired(String email) {
        assertThatThrownBy(() -> new GuestContact("Léa", email, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("guest email");
    }
}
