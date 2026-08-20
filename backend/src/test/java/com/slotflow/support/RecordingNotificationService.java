package com.slotflow.support;

import com.slotflow.notification.NotificationService;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The test double for {@link NotificationService}: it keeps the last message sent to each address
 * instead of logging it.
 *
 * <p>It exists because the raw token is the one thing the API deliberately never returns. An
 * invitation or a reset link is only usable by whoever received the mail, so a test that wants to
 * accept an invitation has to read the token the way the invitee would. This is that inbox.
 *
 * <p>Registered once, in {@link ApiIntegrationTest}, so every API test shares a single application
 * context. A per-class {@code @MockitoBean} would work too and would fork the context cache for
 * each test class, which is the mistake the harness was built to avoid.
 */
public class RecordingNotificationService implements NotificationService {

    /** One entry per address, latest wins — a resend supersedes the invitation it replaces. */
    public record Sent(Recipient recipient, String rawToken, Instant expiresAt, String businessName) {
    }

    private final Map<String, Sent> invitations = new ConcurrentHashMap<>();
    private final Map<String, Sent> passwordResets = new ConcurrentHashMap<>();

    @Override
    public void sendPasswordReset(Recipient recipient, String rawToken, Instant expiresAt) {
        passwordResets.put(key(recipient), new Sent(recipient, rawToken, expiresAt, null));
    }

    @Override
    public void sendStaffInvitation(Recipient recipient, String businessName,
                                    String rawToken, Instant expiresAt) {
        invitations.put(key(recipient), new Sent(recipient, rawToken, expiresAt, businessName));
    }

    public Sent invitationTo(String email) {
        Sent sent = invitations.get(email.toLowerCase());
        if (sent == null) {
            throw new AssertionError("no invitation was sent to " + email);
        }
        return sent;
    }

    public Sent passwordResetTo(String email) {
        Sent sent = passwordResets.get(email.toLowerCase());
        if (sent == null) {
            throw new AssertionError("no password reset was sent to " + email);
        }
        return sent;
    }

    public boolean sentNothingTo(String email) {
        String key = email.toLowerCase();
        return !invitations.containsKey(key) && !passwordResets.containsKey(key);
    }

    /** Called before every test, so one test's mail cannot be read by the next. */
    public void clear() {
        invitations.clear();
        passwordResets.clear();
    }

    private static String key(Recipient recipient) {
        return recipient.email().toLowerCase();
    }
}
