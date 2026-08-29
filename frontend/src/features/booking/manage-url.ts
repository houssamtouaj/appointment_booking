/**
 * `{origin}/booking/{cancellationToken}` — the same URL the backend puts in the
 * confirmation email.
 *
 * Built from `window.location.origin` rather than from a configured base URL,
 * and the difference matters on the deployed pair: the SPA is served from Vercel
 * while `app.frontend.base-url` is a *backend* setting, so a client-side copy of
 * it would be a second source of truth that goes stale the day a preview
 * deployment gets its own hostname. The origin is, by definition, where this
 * page actually is — so the link shown to a customer is one that works from
 * where they are reading it.
 *
 * The route itself is not ours to rename (F12): `FrontendLinks.manageBooking`
 * emits `/booking/{token}` into mail that will be opened weeks from now.
 */
export function manageUrlFor(cancellationToken: string): string {
  return `${window.location.origin}/booking/${cancellationToken}`
}
