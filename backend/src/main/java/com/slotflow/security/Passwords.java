package com.slotflow.security;

/**
 * The password rules, in one place because three requests declare them: registration, invitation
 * acceptance and reset.
 *
 * <p>Length only, and no composition rules. A minimum of 8 with no upper-case-digit-symbol
 * requirement is what NIST 800-63B recommends and what actually helps: composition rules push
 * people towards {@code Passw0rd!} and away from a long passphrase. The maximum is the interesting
 * one — <b>BCrypt silently ignores everything past 72 bytes</b>, so accepting a 200-character
 * password would mean quietly authenticating anyone who knew its first 72. Rejecting it is honest.
 */
public final class Passwords {

    public static final int MIN_LENGTH = 8;

    /** BCrypt's own limit, in bytes. Enforced as characters, which is stricter for non-ASCII. */
    public static final int MAX_LENGTH = 72;

    public static final String SIZE_MESSAGE =
            "must be between " + MIN_LENGTH + " and " + MAX_LENGTH + " characters";

    private Passwords() {
    }
}
