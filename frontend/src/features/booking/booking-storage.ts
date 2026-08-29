/**
 * The cancellation token, kept for the length of a Stripe round trip and no
 * longer.
 *
 * **`sessionStorage`, and this is the one credential in the app that goes into
 * storage at all.** The access token deliberately lives in a module variable
 * because an XSS bug must not be able to exfiltrate a session; this is a
 * different kind of secret and the reasoning inverts. It is not a key to an
 * account — there is no account (backend D1) — it *is* the customer's own
 * booking, it is already sitting in their inbox in plain text, and the thing it
 * protects against is not an attacker but a redirect that does not come back.
 *
 * **Not `localStorage`.** `sessionStorage` dies with the tab, which is exactly
 * the lifetime of a redirect to Checkout and back. A token in `localStorage`
 * outlives the booking, survives on a shared machine, and is still there next
 * month offering a stranger someone else's appointment.
 *
 * Every access is wrapped, because storage throws rather than returning null in
 * more browsers than is comfortable: Safari's private mode historically threw
 * `QuotaExceededError` on every write, and any browser configured to block site
 * data throws `SecurityError` on the property read itself. A booking flow must
 * not end at a white screen because a convenience failed.
 */

const KEY = 'slotflow.booking.token'

/** Called immediately before `window.location.assign(checkoutUrl)`, and nowhere else. */
export function rememberBookingToken(cancellationToken: string): void {
  try {
    window.sessionStorage.setItem(KEY, cancellationToken)
  } catch {
    // The redirect still happens and Stripe still returns to a URL carrying the
    // token in its path. This is the fallback for the case where that fails, so
    // failing to write it is not itself worth interrupting anyone over.
  }
}

/** The way back if Stripe's redirect never lands. `undefined` when there is nothing to offer. */
export function rememberedBookingToken(): string | undefined {
  try {
    return window.sessionStorage.getItem(KEY) ?? undefined
  } catch {
    return undefined
  }
}

/** Cleared once the manage page has the booking — the round trip is over. */
export function forgetBookingToken(): void {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    // Nothing to do, and nothing worth saying.
  }
}
