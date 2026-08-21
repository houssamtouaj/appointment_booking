package com.slotflow.staff;

import com.slotflow.business.Business;
import com.slotflow.business.BusinessRepository;
import com.slotflow.common.error.ApiException;
import com.slotflow.common.error.ErrorCode;
import com.slotflow.security.SecretTokens;
import jakarta.persistence.EntityNotFoundException;
import java.time.Clock;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The public half of the invitation flow: what the accept screen reads, and what accepting does.
 *
 * <p>Unauthenticated by necessity — the invitee has no account yet — so the token is the whole
 * credential, and the rules around it carry the weight:
 *
 * <ul>
 *   <li><b>Lookup is by hash.</b> The raw token exists in one email and nowhere else, including
 *       here.</li>
 *   <li><b>Unknown is 404, spent is 410.</b> A token that never existed and a token that has been
 *       used are genuinely different situations for the person holding the link: one is a typo, the
 *       other means "you have already done this, go and sign in". Since the caller already holds the
 *       token, distinguishing them discloses nothing they did not have.</li>
 *   <li><b>Accepting twice is 410, not 500.</b> A double-clicked button, a forwarded mail and a
 *       browser prefetch all produce it, and it must not be a stack trace — nor, more importantly,
 *       a way to reset the password of an account that is already in use. "Already in use" covers
 *       a deactivated one: it has a password, so it is not waiting to be invited.</li>
 * </ul>
 */
@Service
public class InvitationService {

    private static final Logger log = LoggerFactory.getLogger(InvitationService.class);

    private final StaffInvitationRepository invitations;
    private final UserRepository users;
    private final BusinessRepository businesses;
    private final PasswordEncoder passwordEncoder;
    private final Clock clock;

    public InvitationService(StaffInvitationRepository invitations, UserRepository users,
                             BusinessRepository businesses, PasswordEncoder passwordEncoder,
                             Clock clock) {
        this.invitations = invitations;
        this.users = users;
        this.businesses = businesses;
        this.passwordEncoder = passwordEncoder;
        this.clock = clock;
    }

    /** Which business is inviting, and to which address — both already known to the recipient. */
    @Transactional(readOnly = true)
    public InvitationPreviewResponse preview(String rawToken) {
        StaffInvitation invitation = requireUsable(load(rawToken));
        Business business = businesses.findById(invitation.getBusinessId())
                .orElseThrow(() -> new EntityNotFoundException("business for invitation"));
        return new InvitationPreviewResponse(business.getName(), invitation.getEmail());
    }

    /**
     * Sets the name and password the invitee chose, activates the account, and burns the token — in
     * one transaction, so there is no window in which the user is active without a password or the
     * token is spent without the user being usable.
     */
    @Transactional
    public void accept(String rawToken, AcceptInvitationRequest request) {
        StaffInvitation invitation = requireUsable(load(rawToken));
        User invited = users.findById(invitation.getUserId())
                .orElseThrow(() -> new EntityNotFoundException("invited user"));

        if (invited.isActive() || invited.hasPassword()) {
            // Two cases, one answer, because to whoever holds the link they are the same fact: it
            // no longer works. Either the row was activated by another route — a second still-valid
            // invitation, or a resend accepted first — or it belongs to somebody who accepted once
            // and was later deactivated. That second case is the dangerous one: accepting would
            // overwrite an existing password hash and switch a withdrawn account back on, which
            // turns an old invitation into self-service reactivation. Only a user who has never had
            // a password can be activated from here.
            throw consumed();
        }

        invited.acceptInvitation(request.fullName(), passwordEncoder.encode(request.password()));
        invitation.markUsed(clock.instant());
        users.save(invited);
        invitations.save(invitation);
        log.info("Invitation accepted by {} for business {}",
                invited.getId(), invitation.getBusinessId());
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    private StaffInvitation load(String rawToken) {
        return invitations.findByTokenHash(SecretTokens.hash(rawToken))
                .orElseThrow(() -> new EntityNotFoundException("no such invitation"));
    }

    /** Used and expired are one answer: the link no longer works, and a new one has to be sent. */
    private StaffInvitation requireUsable(StaffInvitation invitation) {
        if (!invitation.isValid(clock.instant())) {
            throw consumed();
        }
        return invitation;
    }

    private static ApiException consumed() {
        return new ApiException(ErrorCode.INVITATION_CONSUMED,
                "This invitation is no longer valid. Ask for a new one.");
    }
}
