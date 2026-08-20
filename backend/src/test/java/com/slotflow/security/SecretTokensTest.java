package com.slotflow.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.HashSet;
import java.util.Set;
import java.util.stream.IntStream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The token primitives behind refresh tokens, reset links and invitations.
 *
 * <p>Small, and worth testing precisely because it is small: the {@code varchar(64)} columns and the
 * unique indexes in {@code V1__baseline.sql} assume 64 lower-case hex characters, and a change here
 * that produced 44 base64 characters instead would fail as a constraint violation somewhere that
 * looks unrelated.
 */
class SecretTokensTest {

    @Test
    @DisplayName("a token is 256 bits, URL-safe and unpadded")
    void tokensAreUrlSafeAndLongEnough() {
        String token = SecretTokens.random();

        // 32 bytes in base64url with no padding: 43 characters.
        assertThat(token).hasSize(43).matches("^[A-Za-z0-9_-]+$");
    }

    @Test
    @DisplayName("tokens do not repeat")
    void tokensAreUnique() {
        Set<String> tokens = new HashSet<>();
        IntStream.range(0, 1_000).forEach(i -> tokens.add(SecretTokens.random()));

        // Not a test of SecureRandom, which needs no help from here. It is a test that the generator
        // is actually called per invocation rather than, say, memoised into a field.
        assertThat(tokens).hasSize(1_000);
    }

    @Test
    @DisplayName("the hash is 64 lower-case hex characters, which is what the columns hold")
    void hashesFitTheSchema() {
        assertThat(SecretTokens.hash(SecretTokens.random()))
                .hasSize(64)
                .matches("^[0-9a-f]{64}$");
    }

    @Test
    @DisplayName("hashing is deterministic, or lookup by hash could not work at all")
    void hashingIsStable() {
        String token = SecretTokens.random();

        assertThat(SecretTokens.hash(token)).isEqualTo(SecretTokens.hash(token));
        assertThat(SecretTokens.hash(token)).isNotEqualTo(SecretTokens.hash(SecretTokens.random()));
    }

    @Test
    @DisplayName("the hash is a known SHA-256, not some other digest")
    void hashIsSha256() {
        // The one fixed vector in this file. If someone swaps the algorithm for MD5 or adds a salt,
        // every other assertion here still passes and this one does not — and a salted hash would
        // silently break lookup-by-hash, because the salt is not stored anywhere.
        assertThat(SecretTokens.hash("abc")).isEqualTo(
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    @Test
    @DisplayName("hashing nothing is a programming error, not an empty hash")
    void blankInputIsRejected() {
        assertThatThrownBy(() -> SecretTokens.hash(null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> SecretTokens.hash("  "))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
