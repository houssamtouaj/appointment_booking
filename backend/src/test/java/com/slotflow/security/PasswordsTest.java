package com.slotflow.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

/**
 * The password length rule, and the two BCrypt behaviours it exists because of.
 *
 * <p>The first two tests do not exercise our code at all. They pin {@code BCryptPasswordEncoder},
 * because the entire maximum is an argument about what that class does with a long password, and an
 * argument about a library is worth exactly as much as the assertion underneath it. They are also
 * how anyone raising the cost factor or swapping the encoder finds out that this rule was about the
 * old one.
 */
class PasswordsTest {

    /** Six Cyrillic characters, twelve UTF-8 bytes. Twelve of them are 72 characters, 144 bytes. */
    private static final String CYRILLIC_WORD = "пароль";

    /** Cheapest legal cost: none of this is about how slow BCrypt is. */
    private static final BCryptPasswordEncoder ENCODER = new BCryptPasswordEncoder(4);

    private static final Validator VALIDATOR;

    static {
        try (ValidatorFactory factory = Validation.buildDefaultValidatorFactory()) {
            VALIDATOR = factory.getValidator();
        }
    }

    @Test
    @DisplayName("encoding refuses more than 72 bytes outright, so an unvalidated request is a 500")
    void encodingRefusesOversizedPasswords() {
        String passphrase = CYRILLIC_WORD.repeat(12);
        assertThat(passphrase).hasSize(72);
        assertThat(passphrase.getBytes(StandardCharsets.UTF_8)).hasSize(144);

        // Not the silent truncation the folklore warns about: Spring Security throws. Which is why
        // the missing validation was three unhandled 500s — register, reset-password and accept —
        // and not a quietly weakened account.
        assertThatThrownBy(() -> ENCODER.encode(passphrase))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("72 bytes");

        // 72 bytes is fine in any alphabet, which is what makes bytes the right unit: the same
        // budget buys 72 Latin characters or 36 Cyrillic ones.
        assertThat(ENCODER.encode(CYRILLIC_WORD.repeat(6))).isNotBlank();
        assertThat(ENCODER.encode("a".repeat(Passwords.MAX_BYTES))).isNotBlank();
    }

    @Test
    @DisplayName("verifying compares only the first 72 bytes, so the limit cannot wait until login")
    void verificationTruncates() {
        String stored = ENCODER.encode("a".repeat(Passwords.MAX_BYTES));

        // matches() does truncate, and does not complain. So a password of exactly 72 bytes is
        // accepted by any longer string beginning with it — nothing here can change that, and it is
        // the reason the length has to be settled before a hash is ever written rather than left
        // for the encoder to notice.
        assertThat(ENCODER.matches("a".repeat(Passwords.MAX_BYTES + 40), stored)).isTrue();
    }

    @Test
    @DisplayName("a passphrase over 72 bytes is rejected however few characters it has")
    void tooManyBytesIsRefused() {
        assertThat(messages(CYRILLIC_WORD.repeat(12)))
                .containsExactly(Passwords.TOO_LONG_MESSAGE);
        // The boundary, in the unit that matters.
        assertThat(messages("a".repeat(72))).isEmpty();
        assertThat(messages("a".repeat(73))).containsExactly(Passwords.TOO_LONG_MESSAGE);
        assertThat(messages(CYRILLIC_WORD.repeat(6))).isEmpty();
    }

    @Test
    @DisplayName("the minimum is characters, because that is where the entropy is")
    void tooFewCharactersIsRefused() {
        assertThat(messages("short")).containsExactly(Passwords.TOO_SHORT_MESSAGE);
        // Seven Cyrillic characters are fourteen bytes: counting the minimum in bytes would let
        // this through while demanding twice as much of the same passphrase in Latin script.
        assertThat(messages("парольь")).containsExactly(Passwords.TOO_SHORT_MESSAGE);
        assertThat(messages("паролььь")).isEmpty();
    }

    @Test
    @DisplayName("null belongs to @NotBlank, not here")
    void emptinessIsSomebodyElsesJob() {
        // Two annotations, two messages. A validator that also rejected null would file an absent
        // password under "must be at least 8 characters", which is not what the form should say.
        assertThat(messages(null)).isEmpty();
    }

    private Set<String> messages(String password) {
        Set<ConstraintViolation<Holder>> violations = VALIDATOR.validate(new Holder(password));
        return violations.stream().map(ConstraintViolation::getMessage)
                .collect(java.util.stream.Collectors.toSet());
    }

    private record Holder(@Password String password) {
    }
}
