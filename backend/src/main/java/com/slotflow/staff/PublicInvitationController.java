package com.slotflow.staff;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Accepting an invitation, which has to be reachable without a token: the invitee has no account
 * until the second of these two calls succeeds.
 *
 * <p>The token is in the path rather than in a query parameter because these are the SPA's routes as
 * much as the API's, and a path segment does not end up in a {@code Referer} header, in browser
 * history or in an analytics beacon the way a query string does. It is base64url, so it needs no
 * encoding to be a path segment — {@code LoggingNotificationService} encodes it anyway, on the
 * grounds that the one place a secret becomes a URL is the wrong place to depend on the token
 * format. That class builds the matching SPA link, and it has to: an argument made only on the
 * reading side is undone by whoever writes the URL.
 *
 * <p>Under {@code /api/public/**}, so it is both in the security allowlist and inside the
 * rate limiter's per-IP write budget (D12) — an unauthenticated endpoint that sets a password is
 * exactly the kind that should not be callable a thousand times a minute.
 */
@RestController
@RequestMapping("/api/public/invitations")
@Tag(name = "Invitations", description = "Accepting a staff invitation")
@SecurityRequirements
public class PublicInvitationController {

    private final InvitationService invitations;

    public PublicInvitationController(InvitationService invitations) {
        this.invitations = invitations;
    }

    @GetMapping("/{token}")
    @Operation(summary = "What this invitation is",
            description = "The business name and the invited address, for the accept screen. "
                    + "An unknown token is 404; a used or expired one is 410 INVITATION_CONSUMED.")
    public InvitationPreviewResponse preview(@PathVariable String token) {
        return invitations.preview(token);
    }

    @PostMapping("/{token}/accept")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Accept an invitation",
            description = "Sets the name and password, activates the account and consumes the "
                    + "token. Accepting twice is 410 INVITATION_CONSUMED, never a 500.")
    public void accept(@PathVariable String token,
            @Valid @RequestBody AcceptInvitationRequest request) {
        invitations.accept(token, request);
    }
}
