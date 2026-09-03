/**
 * Every English string this app writes itself. The source of truth (F21).
 *
 * `as const` matters twice over: it gives `TKey` literal key types, and it makes
 * `Same<typeof en>` in fr.ts a shape a translation must match exactly.
 *
 * Organised by where a string appears, not by what it means. A namespace per
 * feature folder plus `common` for what genuinely repeats — a key used in two
 * places belongs in `common`, and a key used once belongs with its screen, which
 * is what keeps a rename local.
 *
 * A plural is an object with `one` and `other` rather than two keys, so that
 * `Intl.PluralRules` can choose and a language with a third category has
 * somewhere to put it.
 */
export const en = {
  common: {
    cancel: 'Cancel',
    back: 'Back',
    signIn: 'Log in',
    signOut: 'Sign out',
    signingOut: 'Signing out…',
    /** `{hours}` and `{minutes}` come from `splitDuration` — see Task 5. */
    durationHoursMinutes: '{hours} hr {minutes} min',
    durationHours: '{hours} hr',
    durationMinutes: '{minutes} min',
  },
  /**
   * Every `ErrorCode` the backend declares, plus the three sentences this module
   * produces that are not codes. `error-copy.test.ts` walks `errorCodeSchema`
   * and fails when one is missing, so a code added to the backend cannot reach a
   * French page as an English sentence.
   *
   * Four rules, which the seven that predate this wave already followed:
   * say what happened then what to do; do not apologise (`INTERNAL_ERROR` is the
   * one exception, being the one case that is actually our fault); never name the
   * enum, the status or a table; and address the customer for the public codes
   * and the operator for the admin ones — `BOOKING_SLOT_TAKEN` is read by
   * somebody booking a haircut and `LAST_OWNER` by somebody running a business.
   */
  errors: {
    // --- Request shape. Every one of these is a bug in this client rather than
    // a mistake a person made, so they share an honest generic sentence: a
    // sentence invented for a case nobody can reach is worse than a fallback.
    VALIDATION_FAILED: 'Some of the details need fixing.',
    MALFORMED_REQUEST: 'That request did not make sense to the server. Try again.',
    MISSING_PARAMETER: 'Something went wrong on our side. Try again in a moment.',
    METHOD_NOT_ALLOWED: 'Something went wrong on our side. Try again in a moment.',
    UNSUPPORTED_MEDIA_TYPE: 'Something went wrong on our side. Try again in a moment.',
    NOT_ACCEPTABLE: 'Something went wrong on our side. Try again in a moment.',

    // --- Generic outcomes
    NOT_FOUND: 'That is no longer there.',
    UNAUTHENTICATED: 'Please sign in and try again.',
    ACCESS_DENIED: 'You do not have access to that.',
    DATA_CONFLICT: 'Something changed while you were working. Reload and try again.',
    RATE_LIMITED: 'Too many attempts. Wait a minute and try again.',
    INTERNAL_ERROR: 'Something went wrong on our side. Try again in a moment.',

    // --- Identity and tenancy. The operator's register.
    SLUG_TAKEN: 'That address is already in use. Choose another.',
    EMAIL_TAKEN: 'That email address already has an account.',
    REFRESH_REUSED: 'Your session was ended for safety. Log in again.',
    INVITATION_CONSUMED: 'That invitation has already been used or has expired.',
    LAST_OWNER: 'A business needs at least one owner. Make somebody else an owner first.',

    // --- Catalogue and configuration
    STAFF_NOT_IN_BUSINESS: 'That team member is not part of this business.',
    HOURS_OVERLAP: 'Those hours overlap another block on the same day. Adjust one of them.',
    TIMEZONE_SHIFT_UNCONFIRMED:
      'Changing the timezone moves every future appointment. Confirm to go ahead.',

    // --- Booking. The customer's register.
    SERVICE_INACTIVE: 'That service is not bookable at the moment.',
    STAFF_NOT_ASSIGNED: 'That person does not perform this service. Choose somebody else.',
    POLICY_LEAD_TIME: 'That is sooner than this business takes bookings. Choose a later time.',
    POLICY_MAX_ADVANCE:
      'That is further ahead than this business takes bookings. Choose an earlier time.',
    SLOT_NOT_ON_GRID: 'That time is no longer on offer. Choose another.',
    SLOT_OUTSIDE_HOURS: 'That time is outside opening hours. Choose another.',
    BOOKING_SLOT_TAKEN: 'That time was taken a moment ago. Choose another.',
    ILLEGAL_TRANSITION: 'That booking has already moved on. Reload to see where it stands.',
    CANCELLATION_CUTOFF: 'It is too late to cancel this online. Contact the business directly.',

    // --- Payments
    PAYMENT_UNAVAILABLE: 'Payments are temporarily unavailable. Try again shortly.',
    /** Server-to-server only; no browser ever reads this. Generic on purpose. */
    WEBHOOK_SIGNATURE_INVALID: 'Something went wrong on our side. Try again in a moment.',

    // --- Not codes: the two other sentences this module produces, and the one
    // override that is error copy rather than screen copy.
    networkFailure: 'We could not reach the server. Check your connection and try again.',
    unknown: 'Something went wrong. Try again in a moment.',
    /**
     * The sign-in form's wording for UNAUTHENTICATED, passed as an override. It
     * lives here rather than under `auth` because it is error copy, and keeping
     * every override key beside the defaults is what stops the two drifting into
     * different voices.
     */
    badCredentials: 'Email or password is incorrect.',
    /**
     * The demo button's wording for the same 401. `SecurityConfig` keeps
     * `/api/auth/demo-login` out of the public allowlist, so a deployment
     * without the `demo` profile refuses it with the same code a wrong password
     * gets — and telling a reviewer who typed no password that their password
     * was wrong is the failure this override exists to prevent.
     */
    demoUnavailable:
      'The demo account is not available — the API is running without its demo profile.',
    /** The booking details step's wording for a 422 it can point at fields for. */
    bookingDetailsInvalid: 'Some of these details need fixing.',
    /** An invitation link that does not resolve, worded for somebody holding a link. */
    invitationUnrecognised:
      'We do not recognise this link. Check that you copied the whole address from the email.',
    /** The hours screens address an operator editing somebody's week. */
    hoursColleagueNotYours: 'That colleague is not in your business.',
    hoursOnlyYourOwn: 'You can only edit your own working hours.',
    hoursOverlapUnsaved: 'Two ranges overlap. Nothing was saved.',
    /** The four admin forms' wording for a 422 they can point at fields for. */
    checkFieldsBelow: 'Check the fields marked below.',
    checkNumbersBelow: 'Check the numbers marked below.',
    checkAddressAndName: 'Check the address and the name.',
    checkTheName: 'Check the name.',
    /** Two ACCESS_DENIEDs a staff member meets by opening a settings tab. */
    ownerOnlyBusiness: 'Only an owner can change the business settings.',
    ownerOnlyPolicy: 'Only an owner can change the booking rules.',
    resetLinkExpired: 'That link is no longer valid. Ask for a new one.',
    invitationSpent: 'This invitation has already been used or has expired.',
    tooManyRequests: 'Too many requests. Wait a minute and try again.',
    /**
     * Field-level wording for the fields this app owns, replacing Bean
     * Validation's English `errors[]` message. One entry per field a form of
     * ours submits; anything unpredicted keeps the server's sentence, which is
     * the wrong language but still names the problem.
     */
    fieldEmail: 'Enter a valid email address.',
    fieldName: 'Enter a name.',
    fieldPassword: 'Passwords need at least eight characters.',
    fieldBusinessName: 'Enter a business name.',
    fieldSlug: 'Use 3 to 40 letters, digits or hyphens.',
    checkDateAndTimes: 'Check the date and times.',
    hoursOnlyYourOwnDays: 'You can only change your own days.',
  },
  language: {
    /** The button's accessible name says what pressing it will do, never the state. */
    switchTo: 'Switch to English',
    groupLabel: 'Language',
  },
  booking: {
    heldUntil: 'Held until {time}',
    slotCount: { one: '{count} time', other: '{count} times' },
  },
} as const
