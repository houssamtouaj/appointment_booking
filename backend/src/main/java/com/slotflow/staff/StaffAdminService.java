package com.slotflow.staff;

import com.slotflow.booking.Booking;
import com.slotflow.booking.BookingRepository;
import com.slotflow.business.Business;
import com.slotflow.business.BusinessRepository;
import com.slotflow.catalog.StaffService;
import com.slotflow.catalog.StaffServiceRepository;
import com.slotflow.common.error.ApiException;
import com.slotflow.common.error.ErrorCode;
import com.slotflow.notification.NotificationRequest;
import com.slotflow.notification.NotificationService;
import com.slotflow.security.AuthProperties;
import com.slotflow.security.RefreshTokenService;
import com.slotflow.security.SecretTokens;
import com.slotflow.tenant.TenantContext;
import jakarta.persistence.EntityNotFoundException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The admin side of the team: listing, inviting, resending and updating colleagues.
 *
 * <p>Every read and every write in here is scoped by {@link TenantContext#businessId()}, which comes
 * from the token's {@code bid} claim. Reads use the repository's {@code businessId} parameter so a
 * foreign row is never loaded at all; writes load by id and then pass through
 * {@link TenantContext#requireOwnedForWrite}, which is what produces the 403 the wave-3 gate asks
 * for while a read of the same id produces a 404.
 *
 * <p>Named {@code StaffAdminService} rather than {@code StaffService} for the same reason plan 03
 * called the entity {@code ServiceOffering}: {@code com.slotflow.catalog.StaffService} is the
 * staff-to-service join row, and two types with one name in the same file is a paragraph of
 * explanation every reader has to hold. The suffix says which side of the API this serves.
 */
@Service
public class StaffAdminService {

    private static final Logger log = LoggerFactory.getLogger(StaffAdminService.class);

    private final UserRepository users;
    private final BusinessRepository businesses;
    private final StaffInvitationRepository invitations;
    private final StaffServiceRepository assignments;
    private final BookingRepository bookings;
    private final RefreshTokenService refreshTokens;
    private final ApplicationEventPublisher notifications;
    private final StaffMapper mapper;
    private final TenantContext tenant;
    private final Duration invitationTtl;
    private final Clock clock;

    public StaffAdminService(UserRepository users, BusinessRepository businesses,
            StaffInvitationRepository invitations,
            StaffServiceRepository assignments, BookingRepository bookings,
            RefreshTokenService refreshTokens,
            ApplicationEventPublisher notifications,
            StaffMapper mapper, TenantContext tenant,
            AuthProperties properties, Clock clock) {
        this.users = users;
        this.businesses = businesses;
        this.invitations = invitations;
        this.assignments = assignments;
        this.bookings = bookings;
        this.refreshTokens = refreshTokens;
        this.notifications = notifications;
        this.mapper = mapper;
        this.tenant = tenant;
        this.invitationTtl = properties.invitationTtl();
        this.clock = clock;
    }

    // ---------------------------------------------------------------------------------
    //  reads
    // ---------------------------------------------------------------------------------

    /**
     * The whole team, active and not, with each person's service assignments.
     *
     * <p>Three queries regardless of team size — the users, the assignments of all of them, the live
     * invitations of all of them — rather than two per row. Each of the three is also bounded by the
     * team: the invitation query filters used and expired rows in SQL rather than loading a table
     * that only ever grows (one row per invite, another per resend, none deleted) in order to throw
     * most of it away. Small numbers here, but this is the shape every later list endpoint copies,
     * and the copy is where it stops being small.
     */
    @Transactional(readOnly = true)
    public List<StaffResponse> list() {
        List<User> team = users.findByBusinessId(tenant.businessId());
        if (team.isEmpty()) {
            return List.of();
        }
        List<UUID> ids = team.stream().map(User::getId).toList();

        Map<UUID, List<UUID>> servicesByStaff = assignments.findForStaff(ids).stream()
                .collect(Collectors.groupingBy(StaffService::getStaffId,
                        Collectors.mapping(StaffService::getServiceId, Collectors.toList())));
        Set<UUID> pending = pendingInvitees(ids);

        return team.stream()
                .sorted(Comparator.comparing(User::getFullName, String.CASE_INSENSITIVE_ORDER))
                .map(user -> mapper.toResponse(user, pending.contains(user.getId()),
                        servicesByStaff.getOrDefault(user.getId(), List.of())))
                .toList();
    }

    /** A read, so another tenant's id is reported as absent rather than as forbidden. */
    @Transactional(readOnly = true)
    public StaffResponse get(UUID staffId) {
        User user = users.findByIdAndBusinessId(staffId, tenant.businessId())
                .orElseThrow(() -> new EntityNotFoundException("staff member " + staffId));
        return toResponse(user);
    }

    // ---------------------------------------------------------------------------------
    //  invitations
    // ---------------------------------------------------------------------------------

    /**
     * Creates the inactive user and the invitation that will activate them, then hands the token to
     * the notification service.
     *
     * <p>The user row exists <em>before</em> the invitee accepts, which is what makes an invitation
     * listable, resendable and revocable rather than a link floating in an inbox. It has no password
     * and {@code active = false}, so it cannot log in — and cannot be reached by a password reset
     * either.
     */
    @Transactional
    public StaffResponse invite(InviteStaffRequest request) {
        String email = request.email().trim().toLowerCase(Locale.ROOT);
        if (users.existsByEmailIgnoreCase(email)) {
            // D13: addresses are globally unique, so this may be somebody else's tenant. The owner
            // learns only what they typed, and inviting a colleague who already has an account
            // somewhere is a real conflict, not a mistake we can resolve for them.
            throw new ApiException(ErrorCode.EMAIL_TAKEN,
                    "That email address already has an account.");
        }

        Business business = business();
        User invited = users.save(
                User.invited(business.getId(), email, request.fullName(), request.role()));
        issueInvitation(business, invited);
        log.info("Invited {} to business {} as {}", email, business.getSlug(), request.role());
        return toResponse(invited);
    }

    /**
     * Supersedes the outstanding invitations and issues a new one.
     *
     * <p>A write, so a foreign id is a 403 — and this endpoint takes a staff id rather than an
     * address precisely so that it cannot be used to probe for accounts elsewhere.
     *
     * <p><b>Only somebody who has never set a password may be re-invited</b>, which is the same
     * test {@link #activate} makes from the other side and for the same reason. Guarding on
     * {@code isActive()} alone lets a resend reach a deactivated ex-employee: they are inactive, so
     * they look like an invitee, but their password hash is still there and {@code accept} would
     * overwrite it and switch the account back on. An owner who had just withdrawn somebody's
     * access would be mailing them a live seven-day key to a password of their own choosing — and
     * the admin list shows both cases as {@code active: false}, so the mistake is one misread row
     * away. The way back for a deactivated colleague is {@code PATCH /api/staff/id} with
     * {@code active: true}, and only that.
     */
    @Transactional
    public StaffResponse resendInvitation(UUID staffId) {
        User invited = loadForWrite(staffId);
        if (invited.isActive()) {
            throw new ApiException(ErrorCode.DATA_CONFLICT,
                    "That colleague has already accepted their invitation.");
        }
        if (invited.hasPassword()) {
            throw new ApiException(ErrorCode.DATA_CONFLICT,
                    "That colleague accepted an invitation before and was deactivated. "
                            + "Reactivate them instead of inviting them again.");
        }
        issueInvitation(business(), invited);
        return toResponse(invited);
    }

    // ---------------------------------------------------------------------------------
    //  updates
    // ---------------------------------------------------------------------------------

    /**
     * Renames, re-roles or deactivates a colleague.
     *
     * <p>Two authorisation rules, both here rather than in an annotation because both depend on the
     * target row: an owner may change anything within their tenant, and a staff member may change
     * their own name and nothing else. The second half is what makes
     * {@code PATCH /api/staff/{someoneElse}} a 403 for a staff token.
     *
     * <p>The {@code LAST_OWNER} guard covers deactivation <em>and</em> demotion: a business with no
     * active owner has nobody who can invite one, which is a state the API must refuse to create
     * rather than one an administrator has to repair by hand.
     */
    @Transactional
    public StaffUpdateResponse update(UUID staffId, UpdateStaffRequest request) {
        tenant.requireOwnerOrSelf(staffId);
        if (!tenant.isOwner() && request.changesPrivilegedFields()) {
            throw new AccessDeniedException("only an owner may change a role or an active flag");
        }

        User user = loadForWrite(staffId);
        boolean losesOwnerRights = (request.role() != null && request.role() != Role.OWNER)
                || Boolean.FALSE.equals(request.active());
        if (user.isOwner() && user.isActive() && losesOwnerRights) {
            requireAnotherActiveOwner(user);
        }

        if (request.fullName() != null) {
            user.rename(request.fullName());
        }
        if (request.role() != null) {
            // Takes effect on the target's next refresh: their current access token carries the old
            // role for up to fifteen minutes. Documented in the README, not papered over here.
            user.changeRole(request.role());
        }

        StaffUpdateResponse.DeactivationWarning warning = null;
        if (request.active() != null && request.active() != user.isActive()) {
            if (request.active()) {
                activate(user);
            } else {
                warning = deactivate(user);
            }
        }

        users.save(user);
        return new StaffUpdateResponse(toResponse(user), warning);
    }

    /**
     * Reactivates someone who was deactivated — and refuses to activate someone who never
     * accepted.
     *
     * <p>Without that second half, an owner could flip the {@code active} flag on a pending
     * invitee and produce a user who is active with no password: unable to log in, and yet listed
     * on the public booking page as somebody a customer can book with. The invitation is the only
     * route from invited to active, because it is the only route that sets a password.
     *
     * <p>{@link #resendInvitation} enforces the same rule from the other end, so the two
     * transitions cannot be swapped: an invitee becomes active by accepting, a deactivated
     * colleague becomes active here, and neither route can do the other's job.
     */
    private void activate(User user) {
        if (!user.hasPassword()) {
            throw new ApiException(ErrorCode.DATA_CONFLICT,
                    "That colleague has not accepted their invitation yet. Resend it instead.");
        }
        user.activate();
    }

    /**
     * Blocks login now, and leaves the calendar alone.
     *
     * <p>Refresh tokens are revoked immediately, so the session ends at the next rotation instead of
     * lasting another week. The access token they already hold keeps working for up to fifteen
     * minutes — the same documented window as everywhere else, and the reason a deactivation is not
     * a security control against someone actively holding a token, only against a returning one.
     */
    private StaffUpdateResponse.DeactivationWarning deactivate(User user) {
        user.deactivate();
        int revoked = refreshTokens.revokeAllFor(user.getId());
        List<Booking> upcoming = bookings.findUpcomingActiveForStaff(user.getId(), clock.instant());
        log.info("Deactivated {} in business {}: {} refresh token(s) revoked, {} upcoming booking(s) kept",
                user.getId(), user.getBusinessId(), revoked, upcoming.size());

        return upcoming.isEmpty()
                ? null
                : new StaffUpdateResponse.DeactivationWarning(
                        upcoming.size(), upcoming.getFirst().getStartsAt());
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    /**
     * Creates a token, supersedes anything outstanding, and sends the link.
     *
     * <p>Superseding matters: without it, every "resend it, I never got the mail" leaves another
     * live key to the account for a week. It is spelled as {@code markUsed} because the schema has
     * one column for "no longer valid" and deleting the row would lose the trail.
     *
     * <p>The mail is published rather than sent, so it goes out after this transaction commits. The
     * ordering is load-bearing in one direction only: superseding the old token and issuing the new
     * one must be atomic with each other, and neither must be visible to a recipient before it is
     * true.
     */
    private void issueInvitation(Business business, User invited) {
        Instant now = clock.instant();
        List<StaffInvitation> outstanding = invitations.findByUserIdAndUsedAtIsNull(invited.getId());
        outstanding.forEach(invitation -> invitation.markUsed(now));
        invitations.saveAll(outstanding);

        String rawToken = SecretTokens.random();
        Instant expiresAt = now.plus(invitationTtl);
        invitations.save(new StaffInvitation(business.getId(), invited.getId(), invited.getEmail(),
                SecretTokens.hash(rawToken), expiresAt));

        // Published, not sent: NotificationDispatcher delivers it after this transaction commits.
        // Sending here would mail a live seven-day link for a row a later failure rolls back, and
        // leave the owner nothing to resend from.
        notifications.publishEvent(new NotificationRequest.StaffInvitation(
                new NotificationService.Recipient(invited.getEmail(), invited.getFullName()),
                business.getName(), rawToken, expiresAt));
    }

    /** A write path: load by id, then guard, so a foreign id is refused rather than hidden. */
    private User loadForWrite(UUID staffId) {
        User user = users.findById(staffId)
                .orElseThrow(() -> new EntityNotFoundException("staff member " + staffId));
        return tenant.requireOwnedForWrite(user);
    }

    private void requireAnotherActiveOwner(User owner) {
        long activeOwners = users.countByBusinessIdAndRoleAndActiveTrue(
                owner.getBusinessId(), Role.OWNER);
        if (activeOwners <= 1) {
            throw new ApiException(ErrorCode.LAST_OWNER,
                    "This is the only active owner. Promote someone else first.");
        }
    }

    private Business business() {
        return businesses.findById(tenant.businessId())
                .orElseThrow(() -> new IllegalStateException(
                        "token names a business that does not exist: " + tenant.businessId()));
    }

    private StaffResponse toResponse(User user) {
        List<UUID> serviceIds = assignments.findByStaffId(user.getId()).stream()
                .map(StaffService::getServiceId)
                .toList();
        return mapper.toResponse(user, !pendingInvitees(List.of(user.getId())).isEmpty(), serviceIds);
    }

    /**
     * "Which of these people have a live invitation?" — the single-row and whole-team paths ask it
     * through the same query, so the rule cannot drift between the staff list and the response to a
     * resend. "Live" means neither used nor expired: an invitation that has simply run out leaves an
     * inactive colleague with no working link, which the owner has to be able to see in order to
     * resend it.
     *
     * <p>One clock reading, taken here. Evaluating {@code clock.instant()} inside a per-row lambda
     * lets the boundary move mid-response, so two colleagues whose invitations expire in the same
     * second could be reported differently in one list.
     */
    private Set<UUID> pendingInvitees(Collection<UUID> userIds) {
        return invitations.findPending(userIds, clock.instant());
    }
}
