package com.slotflow.security;

import com.slotflow.business.BookingPolicy;
import com.slotflow.business.BookingPolicyRepository;
import com.slotflow.business.Business;
import com.slotflow.business.BusinessFields;
import com.slotflow.business.BusinessRepository;
import com.slotflow.common.error.ApiException;
import com.slotflow.common.error.ErrorCode;
import com.slotflow.notification.NotificationRequest;
import com.slotflow.notification.NotificationService;
import com.slotflow.staff.User;
import com.slotflow.staff.UserRepository;
import java.time.ZoneId;
import java.util.Currency;
import java.util.Locale;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Registration, login, refresh, logout and password reset.
 *
 * <h2>Two rules run through everything here</h2>
 *
 * <ul>
 *   <li><b>One transaction per use case, and no BCrypt inside it.</b> {@link #register} in
 *       particular creates three rows — a business, its policy and its owner — and a partial tenant
 *       is unusable in a way that is hard to notice and impossible to repair from the API: the slug
 *       is taken, so the owner cannot retry. {@code AuthFlowIT} forces a failure on the last insert
 *       and asserts that nothing survives. The transaction is a {@link TransactionTemplate} around
 *       exactly those writes rather than {@code @Transactional} on the whole method, because the
 *       expensive part of every method here is a password hash and a hash needs no database at
 *       all — see {@link #writes}.</li>
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
    private final ApplicationEventPublisher notifications;
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

    /**
     * The write half of a use case, in a transaction that starts after the hashing is done.
     *
     * <p>BCrypt at strength 12 is hundreds of milliseconds of deliberate key stretching, and
     * Hibernate holds the JDBC connection it acquired for the whole transaction — measured, not
     * assumed: a connection stays checked out across the hash with no statement in flight. Hashing
     * inside {@code @Transactional} therefore parks a connection doing nothing for a quarter of a
     * second per sign-in, which with {@code maximum-pool-size: 10} caps logins near forty a second
     * and lets a burst of them starve every unrelated request of a connection. The fix is only the
     * order of operations: look up, let the transaction end, hash, then a short transaction for the
     * writes.
     *
     * <p>A {@code TransactionTemplate} rather than moving the writes into a second bean, because a
     * private method annotated {@code @Transactional} and called from this class is a
     * self-invocation: it does not pass through the proxy, the annotation is silently ignored, and
     * {@code register} would quietly stop being one transaction while every test still passed.
     * {@code RefreshTokenService} carries the same argument for the same reason.
     */
    private final TransactionTemplate writes;

    public AuthService(UserRepository users, BusinessRepository businesses,
            BookingPolicyRepository policies, RefreshTokenService refreshTokens,
            PasswordResetService passwordResets,
            ApplicationEventPublisher notifications,
            PasswordEncoder passwordEncoder, JwtService jwtService, AuthMapper mapper,
            PlatformTransactionManager transactionManager) {
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
        this.writes = new TransactionTemplate(transactionManager);
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
     *
     * <h3>{@code EMAIL_TAKEN} is an enumeration oracle, and it is a deliberate trade</h3>
     * Say it plainly, because {@link #login} goes to some trouble to be unreadable and this
     * endpoint gives the same fact away for nothing: {@code 409} versus {@code 201} tells an
     * unauthenticated caller whether an address has an account here. Addresses are global (D13), so
     * the answer covers every tenant, and {@code RateLimitFilter}'s {@code PUBLIC_WRITE} budget of
     * ten writes per minute per IP puts a ceiling of roughly fourteen thousand probes a day on it.
     *
     * <p>It stays because the alternative is not available yet, not because the oracle is
     * imaginary. Masking it means answering {@code 202 "check your inbox"} whether or not the
     * account was created, and that only works if the address is verified by mail before the
     * account becomes usable — plan 12 owns the transport, and until it lands
     * {@link com.slotflow.notification.NotificationService} writes links to a log file. Faking the
     * success in the meantime would mean returning a session for a tenant that does not exist.
     *
     * <p>Two things that look like cheaper fixes are not. Reordering the checks so the slug loses
     * first buys nothing: a prober supplies a fresh random slug and reads the answer anyway. Nor
     * does collapsing both into one generic {@code 409}, because plan 05 requires
     * {@code SLUG_TAKEN} to be distinguishable — the form has to offer another address inline —
     * and a slug is public by construction: anyone can fetch the booking page and see whether it
     * is taken.
     *
     * <p>What this trade must not be allowed to leak into is {@link #login}, where the same fact
     * would be worth much more: there, wrong password, unknown address and deactivated account
     * return byte-identical bodies after exactly one BCrypt verification, and
     * {@code AuthFlowIT.failedLoginsAreIndistinguishable} compares the three responses as strings.
     * A registration probe tells an attacker that an account exists; a login probe would tell them
     * when they have guessed its password.
     */
    public AuthSession register(RegisterRequest request) {
        String email = normaliseEmail(request.email());
        String slug = request.slug().trim().toLowerCase(Locale.ROOT);
        // Parsed through BusinessFields, which PUT /api/business shares: an offset zone that
        // registration refuses must not be a zone the settings screen accepts.
        ZoneId timezone = BusinessFields.timezone(request.timezone());
        Currency currency = BusinessFields.currency(request.currency());

        if (users.existsByEmailIgnoreCase(email)) {
            // D13: globally unique, so this can be another tenant's owner — and answering at all
            // confirms the address is registered somewhere. That is the trade argued above, taken
            // knowingly and bounded by the rate limiter, not an oversight: the sign-up form cannot
            // say "sign in instead" without being told which field lost.
            throw new ApiException(ErrorCode.EMAIL_TAKEN,
                    "That email address is already registered.");
        }
        if (businesses.existsBySlug(slug)) {
            throw new ApiException(ErrorCode.SLUG_TAKEN,
                    "The address \"%s\" is already taken. Try another.".formatted(slug))
                    .with("slug", slug);
        }

        // Outside the transaction below, on purpose. Nothing here needs a database, and a
        // registration is one of the two places in the codebase that pays for a hash.
        String passwordHash = passwordEncoder.encode(request.password());

        return writes.execute(status -> {
            Business business = businesses.save(
                    new Business(slug, request.businessName(), timezone, currency));
            policies.save(BookingPolicy.defaultsFor(business.getId()));
            User owner = users.save(
                    User.owner(business.getId(), email, request.fullName(), passwordHash));

            log.info("Registered business {} ({}) with owner {}", business.getSlug(),
                    business.getId(), owner.getId());
            return sessionFor(owner, business);
        });
    }

    // ---------------------------------------------------------------------------------
    //  session lifecycle
    // ---------------------------------------------------------------------------------

    /**
     * Not {@code @Transactional}, and that is the point: the one expensive step is the BCrypt
     * verification, and it must not happen with a connection checked out. Three short transactions —
     * the lookup, the business read, the refresh-token insert — cost three round trips and hold a
     * connection for none of the hashing. See {@link #writes}.
     */
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
     *
     * <p>Not {@code @Transactional} either, and here it is load-bearing rather than merely tidy:
     * {@link RefreshTokenService#rotate} answers a replayed token by revoking the chain in its own
     * transaction and then throwing, and an enclosing transaction would make that a suspended one —
     * two connections held by a single request, which ten simultaneous replays turn into a stalled
     * pool.
     */
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
     * <p>Not literally constant time — one branch writes a token row and publishes a notification —
     * but there is no branch a caller can observe: same status, same empty body, and no difference
     * of the order a network round trip would reveal. The alternative, a 404 for an unknown address,
     * is a bulk account-enumeration endpoint.
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
                    // After commit, via NotificationDispatcher. A reset link for a token row that
                    // rolled back is a link that says "invalid or expired" to somebody who just
                    // asked for it, and no amount of retrying on their part fixes it.
                    notifications.publishEvent(new NotificationRequest.PasswordReset(
                            new NotificationService.Recipient(user.getEmail(), user.getFullName()),
                            issued.rawValue(), issued.expiresAt()));
                });
    }

    /**
     * Consumes the token, sets the password, and <b>revokes every refresh token the user holds</b>.
     * That last step is the point of a reset: if the account was taken over, the sessions the
     * takeover created have to die with the old password, or the reset has accomplished nothing.
     */
    public void resetPassword(ResetPasswordRequest request) {
        // Hashed before the token is even looked at, for the reason given on writes: this is the
        // third of the three places a request pays for BCrypt, and none of them needs a connection
        // while they do. Burning a hash on a bad token costs an attacker the same rate-limited
        // request that login already costs them, and login hashes unconditionally by design.
        String passwordHash = passwordEncoder.encode(request.password());

        writes.execute(status -> {
            User user = users.findById(passwordResets.consume(request.token()))
                    .orElseThrow(AuthService::invalidCredentials);
            user.changePassword(passwordHash);
            users.save(user);
            int revoked = refreshTokens.revokeAllFor(user.getId());
            log.info("Password reset for user {}; revoked {} refresh token(s)",
                    user.getId(), revoked);
            return null;
        });
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

    /** One exception, one detail, for every way authentication can fail. */
    private static ApiException invalidCredentials() {
        return new ApiException(ErrorCode.UNAUTHENTICATED, "Invalid email or password.");
    }
}
