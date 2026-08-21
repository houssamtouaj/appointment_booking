package com.slotflow.security;

import java.nio.charset.StandardCharsets;

/**
 * The password rules, in one place because three requests declare them: registration, invitation
 * acceptance and reset. Applied through {@link Password}.
 *
 * <h2>The minimum is characters, and there are no composition rules</h2>
 * Eight characters, with no upper-case-digit-symbol requirement, is what NIST 800-63B recommends
 * and what actually helps: composition rules push people towards {@code Passw0rd!} and away from a
 * long passphrase. Characters rather than bytes, because that is where the entropy is — counting
 * the minimum in bytes would quietly demand fewer letters of a Cyrillic or CJK passphrase than of
 * a Latin one.
 *
 * <h2>The maximum is bytes, and that is the whole point of this class</h2>
 * <b>BCrypt only ever looks at the first 72 bytes of a password.</b> A limit of 72 <em>characters</em>
 * is therefore not a stricter reading of the same rule, it is a different and wrong one: 72
 * characters of Cyrillic are 144 UTF-8 bytes and 72 of most CJK are 216.
 *
 * <p>What that costs us today is worth spelling out, because it is not what the classic warning
 * about BCrypt says. Spring Security's implementation does not silently truncate on the way in —
 * {@code BCryptPasswordEncoder.encode} throws {@code IllegalArgumentException("password cannot be
 * more than 72 bytes")}. So without this rule an over-long passphrase is not a quietly weakened
 * account, it is an unhandled 500 on {@code /api/auth/register}, {@code /api/auth/reset-password}
 * and {@code /api/public/invitations/{token}/accept}: two of them unauthenticated, one of them the
 * only way an invited colleague can ever sign in, and all three logging a stack trace for a request
 * that was merely too long. A 422 naming the field is the answer the caller can act on.
 *
 * <p>Verification is the half that does truncate: {@code matches} compares only the first 72 bytes,
 * so a stored 72-byte password is accepted by any longer string that begins with it. Nothing can be
 * done about that from here — it is BCrypt — and it is why the limit has to be enforced before a
 * password is ever stored rather than left to the encoder to notice.
 */
public final class Passwords {

    /** Characters. */
    public static final int MIN_LENGTH = 8;

    /** UTF-8 bytes, which is BCrypt's own unit — see the class note on why not characters. */
    public static final int MAX_BYTES = 72;

    public static final String TOO_SHORT_MESSAGE =
            "must be at least " + MIN_LENGTH + " characters";

    public static final String TOO_LONG_MESSAGE =
            "must be at most " + MAX_BYTES + " bytes long; characters outside the Latin alphabet "
                    + "count as more than one";

    /** For the OpenAPI document, which loses bean validation's own hints for a custom constraint. */
    public static final String SCHEMA_DESCRIPTION =
            "At least " + MIN_LENGTH + " characters and at most " + MAX_BYTES + " UTF-8 bytes. "
                    + "No composition rules: a long passphrase is the point.";

    private Passwords() {
    }

    public static boolean isTooShort(String password) {
        return password.length() < MIN_LENGTH;
    }

    /** Everything past this is invisible to BCrypt, so a password containing it is not one. */
    public static boolean exceedsBcryptLimit(String password) {
        return password.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES;
    }
}
