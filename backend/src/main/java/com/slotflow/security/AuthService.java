package com.slotflow.security;

import com.slotflow.business.BookingPolicy;
import com.slotflow.business.BookingPolicyRepository;
import com.slotflow.business.Business;
import com.slotflow.business.BusinessRepository;
import com.slotflow.common.error.ApiException;
import com.slotflow.common.error.ErrorCode;
import com.slotflow.common.error.Problems;
import com.slotflow.common.error.ValidationError;
import com.slotflow.notification.NotificationService;
import com.slotflow.staff.User;
import com.slotflow.staff.UserRepository;
import java.time.ZoneId;
import java.util.Currency;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Registration, login, refresh, logout and password reset.
 *
 * <h2>Two rules run through everything here</h2>
 *
 * <ul>
 *   <li><b>One transaction per use case.</b> {@link #register} in particular creates three rows —
 *       a business, its policy and its owner — and a partial tenant is unusable in a way that is
 *       hard to notice and impossible to repair from the API: the slug is taken, so the owner
 *       cannot retry. {@code AuthFlowIT} forces a failure on the last insert and asserts that
 *       nothing survives.</li>
 *   <li><b>One answer for every authentication failure.</b> Unknown address, wrong password and
 *       deactivated account produce a byte-identical body, and {@link #login} does exactly one
 *       BCrypt verification on every path so that the timing does not answer what the body
 *       refuses to. Anything less is an account-enumeration oracle, and this is the endpoint an
 *       attacker starts with.</li>
 * </ul>
 */
@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);

    private final UserRepository users;
    private final BusinessRepository businesses;
    private final BookingPolicyRepository policies;
    private final RefreshTokenService refreshTokens;
    private final PasswordResetService passwordResets;
    private final NotificationService notifications;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final AuthMapper mapper;

    /**
     * A real BCrypt hash of a value nobody knows, at the configured cost, computed once at startup.
     *
     * <p>It is what {@link #login} verifies against when there is no user or no password to verify
     * against, so that every login costs the same one hash. A hard-coded literal would not do: a
     * hash at the wrong cost factor, or a malformed one, makes {@code matches} return false
     * immediately and hands the timing difference straight back.
     */
    private final String absentPasswordHash;

    public AuthService(UserRepository users, BusinessRepository businesses,
                       BookingPolicyRepository policies, RefreshTokenService refreshTokens,
                       PasswordResetService passwordResets, NotificationService notifications,
                       PasswordEncoder passwordEncoder, JwtService jwtService, AuthMapper mapper) {
        this.users = users;
        this.businesses = businesses;
        this.policies = policies;
        this.refreshTokens = refreshTokens;
        this.passwordResets = passwordResets;
        this.notifications = notifications;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.mapper = mapper;
        this.absentPasswordHash = passwordEncoder.encode(SecretTokens.random());
    }

    // ---------------------------------------------------------------------------------
    //  registration
    // ---------------------------------------------------------------------------------

    /**
     * Creates a tenant: {@code business} + {@code booking_policy} + owner {@code app_user}, and
     * logs the owner straight in.
     *
     * <p>Both uniqueness checks are made before any insert so the caller gets {@code SLUG_TAKEN} or
     * {@code EMAIL_TAKEN} rather than a generic conflict — the sign-up form offers an alternative
     * slug inline, and it can only do that if it knows which field lost. The unique indexes remain
     * the actual guarantee: two simultaneous registrations of the same slug end with one of them
     * seeing a {@code 409} from the constraint, which is correct and needs no branch of its own.
     */
    @Transactional
    public AuthSession register(RegisterRequest request) {
        String email = normaliseEmail(request.email());
        String slug = request.slug().trim().toLowerCase(Locale.ROOT);
        ZoneId timezone = parseTimezone(request.timezone());
        Currency currency = parseCurrency(request.currency());

        if (users.existsByEmailIgnoreCase(email)) {
            // D13: globally unique, so this can be another tenant's owner. The message says no more
            // than the caller already knows, having just typed the address.
            throw new ApiException(ErrorCode.EMAIL_TAKEN,
                    "That email address is already registered.");
        }
        if (businesses.existsBySlug(slug)) {
            throw new ApiException(ErrorCode.SLUG_TAKEN,
                    "The address \"%s\" is already taken. Try another.".formatted(slug))
                    .with("slug", slug);
        }

        Business business = businesses.save(
                new Business(slug, request.businessName(), timezone, currency));
        policies.save(BookingPolicy.defaultsFor(business.getId()));
        User owner = users.save(User.owner(business.getId(), email, request.fullName(),
                passwordEncoder.encode(request.password())));

        log.info("Registered business {} ({}) with owner {}", business.getSlug(),
                business.getId(), owner.getId());
        return sessionFor(owner, business);
    }

    // ---------------------------------------------------------------------------------
    //  session lifecycle
    // ---------------------------------------------------------------------------------

    @Transactional
    public AuthSession login(LoginRequest request) {
        Optional<User> candidate = users.findByEmailIgnoreCase(normaliseEmail(request.email()));

        // Deliberately unconditional, and deliberately before any decision: exactly one BCrypt
        // verification happens whether the address exists, belongs to an invited user who has not
        // set a password yet, or belongs to a deactivated one.
        String storedHash = candidate.filter(User::hasPassword)
                .map(User::getPasswordHash)
                .orElse(absentPasswordHash);
        boolean passwordMatches = passwordEncoder.matches(request.password(), storedHash);

        User user = candidate
                .filter(User::canLogIn)
                .filter(found -> passwordMatches)
                .orElseThrow(AuthService::invalidCredentials);

        return sessionFor(user, businessOf(user));
    }

    /**
     * Rotates the refresh token and issues a new access token.
     *
     * <p>This is also where a deactivation or a role change takes effect: the claims are rebuilt
     * from the row, and an inactive user cannot get past {@link User#canLogIn()}. The
     * fifteen-minute gap between such a change and this moment is the documented cost of stateless
     * access tokens — see {@link JwtService}.
     */
    @Transactional
    public AuthSession refresh(String rawRefreshToken) {
        RefreshTokenService.Rotation rotation = refreshTokens.rotate(rawRefreshToken);
        User user = users.findById(rotation.userId())
                .filter(User::canLogIn)
                .orElseThrow(AuthService::invalidCredentials);

        MeResponse me = mapper.toMe(user, businessOf(user));
        return new AuthSession(
                AuthResponse.of(jwtService.issue(user), jwtService.accessTokenTtl(), me),
                rotation.successor().rawValue(),
                refreshTokens.ttl());
    }

    /**
     * Revokes the presented refresh token. The access token keeps working until it expires — there
     * is no blocklist, on purpose, and that window is the price of a stateless check on every
     * request. Fifteen minutes, written down here and in the README rather than discovered later.
     */
    @Transactional
    public void logout(String rawRefreshToken) {
        refreshTokens.revoke(rawRefreshToken);
    }

    /**
     * The current user, read from the database rather than from the token, because {@code /me} is
     * exactly the request that should reflect a name or role change as soon as it happens.
     */
    @Transactional(readOnly = true)
    public MeResponse me(AuthPrincipal principal) {
        User user = users.findById(principal.userId())
                .filter(User::canLogIn)
                .orElseThrow(AuthService::invalidCredentials);
        return mapper.toMe(user, businessOf(user));
    }

    // ---------------------------------------------------------------------------------
    //  password reset (D6)
    // ---------------------------------------------------------------------------------

    /**
     * Issues a reset token when the address belongs to someone who can log in, and does nothing
     * when it does not. The controller answers {@code 202} either way.
     *
     * <p>Not literally constant time — one branch writes a token row and calls the notification
     * stub — but there is no branch a caller can observe: same status, same empty body, and no
     * difference of the order a network round trip would reveal. The alternative, a 404 for an
     * unknown address, is a bulk account-enumeration endpoint.
     *
     * <p>An invited user who has not accepted yet is skipped by {@link User#canLogIn()}: their path
     * to a password is the invitation, and letting a reset substitute for it would let anyone who
     * knows a pending invitee's address activate the account without the invite link.
     */
    @Transactional
    public void requestPasswordReset(ForgotPasswordRequest request) {
        users.findByEmailIgnoreCase(normaliseEmail(request.email()))
                .filter(User::canLogIn)
                .ifPresent(user -> {
                    PasswordResetService.Issued issued = passwordResets.issueFor(user.getId());
                    notifications.sendPasswordReset(
                            new NotificationService.Recipient(user.getEmail(), user.getFullName()),
                            issued.rawValue(), issued.expiresAt());
                });
    }

    /**
     * Consumes the token, sets the password, and <b>revokes every refresh token the user holds</b>.
     * That last step is the point of a reset: if the account was taken over, the sessions the
     * takeover created have to die with the old password, or the reset has accomplished nothing.
     */
    @Transactional
    public void resetPassword(ResetPasswordRequest request) {
        User user = users.findById(passwordResets.consume(request.token()))
                .orElseThrow(AuthService::invalidCredentials);
        user.changePassword(passwordEncoder.encode(request.password()));
        users.save(user);
        int revoked = refreshTokens.revokeAllFor(user.getId());
        log.info("Password reset for user {}; revoked {} refresh token(s)", user.getId(), revoked);
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    private AuthSession sessionFor(User user, Business business) {
        MeResponse me = mapper.toMe(user, business);
        RefreshTokenService.Issued refresh = refreshTokens.issueFor(user.getId());
        return new AuthSession(
                AuthResponse.of(jwtService.issue(user), jwtService.accessTokenTtl(), me),
                refresh.rawValue(),
                refreshTokens.ttl());
    }

    /**
     * A user whose business row is missing is a broken invariant, not a client error: the FK is
     * {@code NOT NULL} and cascades, so this can only happen if something bypassed the schema.
     */
    private Business businessOf(User user) {
        return businesses.findById(user.getBusinessId())
                .orElseThrow(() -> new IllegalStateException(
                        "user " + user.getId() + " references a business that does not exist"));
    }

    private static String normaliseEmail(String email) {
        return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * Region ids only. {@code ZoneId.of("+02:00")} parses happily and then has no DST rules at all,
     * which is the one thing a business day genuinely needs — a salon that opens at 09:00 keeps
     * opening at 09:00 through the March transition (D11).
     */
    private static ZoneId parseTimezone(String timezone) {
        String candidate = timezone == null ? "" : timezone.trim();
        if (!ZoneId.getAvailableZoneIds().contains(candidate)) {
            throw invalidField("timezone", "must be an IANA zone id such as Europe/Paris");
        }
        return ZoneId.of(candidate);
    }

    private static Currency parseCurrency(String currency) {
        try {
            return Currency.getInstance(currency.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException | NullPointerException e) {
            throw invalidField("currency", "must be a valid ISO 4217 currency code");
        }
    }

    /**
     * A 422 in the same shape the MVC binder produces, {@code errors[]} included, for the two fields
     * bean validation cannot check: an IANA zone id and an ISO 4217 code are both "well-formed but
     * unknown", and a React form should be able to attach the message to the input either way.
     */
    private static ApiException invalidField(String field, String message) {
        return new ApiException(ErrorCode.VALIDATION_FAILED, Problems.VALIDATION_DETAIL)
                .with(Problems.ERRORS_PROPERTY, List.of(new ValidationError(field, message)));
    }

    /** One exception, one detail, for every way authentication can fail. */
    private static ApiException invalidCredentials() {
        return new ApiException(ErrorCode.UNAUTHENTICATED, "Invalid email or password.");
    }
}
