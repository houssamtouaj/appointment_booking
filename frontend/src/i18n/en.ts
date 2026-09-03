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
  /**
   * The shared pieces in `src/components/` and the two layouts, keyed by the file
   * that owns each string. A key used in one place is named for its place — the
   * promotion to `common` happens on the second use, which is what keeps a rename
   * local.
   */
  /**
   * The five account screens. Namespaced by screen rather than by meaning, so a
   * label that reads the same on two of them stays two keys until somebody has a
   * reason to share one — a shared key is a rename that reaches further than it
   * looks.
   *
   * `AuthLayout` takes `eyebrow`, `title` and `description` as props and is
   * translated at the call site, not inside itself: the layout does not know
   * which screen it is wrapping, and pushing keys into it would make it a switch
   * statement over its own callers.
   */
  auth: {
    /** The eyebrow above all five. One key, because it genuinely is one word. */
    eyebrow: 'Account',
    login: {
      title: 'Log in',
      description: 'Manage your calendar, services and team.',
      noAccount: 'No account yet?',
      createBusiness: 'Create a business',
      demo: 'Log in as demo admin',
      demoNote:
        'Signs you into a seeded business with services, staff and bookings. Nothing you do to it is permanent.',
      /** The rule between the demo button and the form. Lower case on purpose. */
      or: 'or',
      email: 'Email',
      password: 'Password',
      submit: 'Log in',
      submitting: 'Signing in…',
      forgot: 'Forgot your password?',
      /** `{name}` is the person's own, from the response. */
      welcome: 'Signed in as {name}',
    },
    register: {
      title: 'Create a business',
      haveAccount: 'Already have an account?',
      logIn: 'Log in',
      description:
        'One step. You get an owner account, an empty calendar and a public booking page.',
      businessName: 'Business name',
      slug: 'Booking page address',
      slugHint:
        'Letters, digits and hyphens. This is permanent — it is the URL customers bookmark.',
      slugTaken: 'That address is taken. Try another.',
      timezone: 'Timezone',
      timezoneHint: 'Every time in the product is shown in it.',
      currency: 'Currency',
      currencyHint: 'Three letters, ISO 4217.',
      fullName: 'Your name',
      email: 'Email',
      emailTaken: 'An account already exists for this address.',
      password: 'Password',
      passwordHint: 'At least 8 characters.',
      submit: 'Create business',
      submitting: 'Creating…',
    },
    forgot: {
      title: 'Reset your password',
      description: 'We will email you a link. It works once and lasts an hour.',
      backToLogin: 'Back to log in',
      sentTitle: 'Check your inbox',
      /** `{email}` is what was typed. The sentence never confirms it has an account. */
      sentBody:
        'If {email} has an account, a reset link is on its way. It expires in an hour and can be used once.',
      sentSpam:
        'No email? Check spam, then try again — we answer the same way whether or not an account exists, so this page cannot tell you which it was.',
      email: 'Email',
      submit: 'Send the link',
      submitting: 'Sending…',
    },
    reset: {
      title: 'Choose a new password',
      description: 'Setting it signs you out everywhere else — that is what a reset is for.',
      askAgain: 'Ask for a new one',
      password: 'New password',
      passwordHint: 'At least 8 characters.',
      confirm: 'Confirm it',
      /**
       * The Zod refinement's message, and a **key** rather than a sentence: a
       * schema built at module scope captures the language at import time and
       * then never updates. `ResetPasswordPage` translates it at render.
       */
      mismatch: 'The two passwords do not match',
      submit: 'Set the password',
      submitting: 'Saving…',
      done: 'Your password was changed. Sign in with it.',
    },
    invitation: {
      title: 'Join the team',
      loading: 'Loading the invitation',
      consumedTitle: 'This invitation has already been used',
      invalidTitle: 'This invitation is not valid',
      consumedBody:
        'Invitations work once and expire after seven days. Ask an owner of the business to send a new one.',
      goToLogin: 'Go to log in',
      /**
       * One sentence with two placeholders, not three fragments joined in JSX.
       * French puts the verb elsewhere, and a joined string cannot express that.
       */
      invitedBy: '{business} invited {email}. Choose a password to activate the account.',
      fullName: 'Your name',
      password: 'Password',
      passwordHint: 'At least 8 characters.',
      submit: 'Join the team',
      submitting: 'Joining…',
      done: 'Your account is ready. Sign in with your new password.',
    },
    guards: {
      restoring: 'Restoring your session',
      ownerOnly: 'That page is for owners. Your account has staff access.',
    },
    session: {
      logIn: 'Log in',
    },
  },
  components: {
    copyText: {
      copy: 'Copy',
      copied: 'Copied',
      /** `{label}` is the caller's noun: "Your booking link copied". */
      copiedAnnouncement: '{label} copied',
    },
    errorState: {
      retry: 'Try again',
    },
    requestIdNote: {
      /** The word before the id. `error-copy.ts`'s toast line uses the same key. */
      reference: 'Reference',
      /** The toast's one-line form, where the id cannot be its own element. */
      referenceLine: 'Reference {requestId}',
    },
    modal: {
      close: 'Close',
    },
    skipLink: 'Skip to content',
    footerNote: "A booking platform. Times shown in the business's timezone.",
  },
  notFound: {
    eyebrow: 'Error 404',
    title: 'No such page',
    body: 'The link may be incomplete. Links sent by email expire, and some mail clients cut long ones in half — if you followed one, request a fresh link.',
    action: 'Go to the booking page',
  },
  language: {
    /** The button's accessible name says what pressing it will do, never the state. */
    switchTo: 'Switch to English',
    groupLabel: 'Language',
  },
  booking: {
    noServices: {
      title: 'Nothing is bookable here yet',
      body: 'This business has not published any services. Check back, or get in touch with them directly.',
    },
    notFound: {
      eyebrow: 'Error 404',
      title: 'No business here',
      /**
       * `{slug}` is echoed back because "demo-salón" and "demo-salon" are
       * indistinguishable in a sentence and obvious side by side. One key rather
       * than a sentence wrapped around a `<code>`: French does not break there.
       */
      body: 'Nothing is published at /b/{slug}. Check the link for a typo, or ask the business for a fresh one — some mail clients cut long links in half.',
    },
    timezoneNote: {
      /** `{city}` from `zoneCity` and `{abbreviation}` from `Intl` — neither is prose. */
      shownIn: 'Times shown in {city} time ({abbreviation}).',
    },
    checkout: {
      cancelled:
        'No problem — you did not pay, and your slot is still held. You can pick up where you left off below.',
      paid: 'Thank you — your deposit came through.',
      pending:
        'Thanks. We are waiting for your bank to confirm the payment — this page updates itself.',
    },
    openingHours: {
      caption: "Opening hours, shown in the business's local time",
      today: 'Today',
      closed: 'Closed',
      /** The flag on a shift that runs past midnight. */
      nextDay: 'next day',
    },
    summary: {
      service: 'Service',
      with: 'With',
      when: 'When',
      price: 'Price',
      /** Joins a day and a clock. French does not put them in this order. */
      dateAtTime: '{date} at {time}',
    },
    stepper: {
      /** The nav's accessible name. A screen reader hears this before the steps. */
      label: 'Booking steps',
      service: 'Service',
      staff: 'Who',
      slot: 'Time',
      details: 'Details',
    },
    emptyWeek: {
      searchFailedTitle: 'The search could not be completed',
      exhaustedTitle: 'Nothing is bookable in the next two months',
      /** `{business}` is tenant data and stays in its own language. */
      exhaustedBody:
        '{business} has no openings for this service inside its booking window. Its opening hours are on the main page — you may have better luck with a shorter service.',
      seeHours: 'See opening hours',
      title: 'No times this week',
      body: 'This week is fully booked or outside the opening hours. There may be something later.',
      search: 'Find the next opening',
      searching: 'Searching…',
    },
    hold: {
      expired: 'This hold has expired. The slot has gone back into the calendar.',
      /**
       * One sentence, both cases, because the clock and the zone sit in the
       * middle of it and French does not put them where English does. The zone
       * is named because the manage page quotes the same deadline on the
       * viewer's clock — two numbers for one instant is a contradiction only
       * while neither says which clock it is on.
       */
      until: 'This slot is held until {time} ({zone}).',
      untilWithRemaining: 'This slot is held until {time} ({zone}) — {remaining} left.',
      /** `Intl.PluralRules` picks the form; French counts 0 with the singular. */
      minutes: { one: '{count} minute', other: '{count} minutes' },
      seconds: { one: '{count} second', other: '{count} seconds' },
    },
    staffStep: {
      loading: 'Loading who is available',
      errorTitle: 'The team could not be loaded',
      emptyTitle: 'Nobody is set up to perform this service',
      emptyBody: 'It cannot be booked at the moment. Another service may still be available.',
      chooseAnother: 'Choose another service',
      anyone: 'Anyone',
      anyoneNote: 'First available — usually the most times',
    },
    slotStep: {
      previousWeek: 'Previous week',
      nextWeek: 'Next week',
      loading: 'Loading available times',
      errorTitle: 'These times could not be loaded',
      /** `{when}` is `summary.dateAtTime`, already joined on the salon's clock. */
      selected: 'Selected {when}',
      continue: 'Continue',
    },
    details: {
      back: 'Choose a different time',
      name: 'Your name',
      email: 'Email',
      emailHint: 'Your confirmation and the link to manage this booking go here.',
      phone: 'Phone (optional)',
      notes: 'Anything we should know? (optional)',
      notesHint: 'Allergies, a preference, where to park.',
      submit: 'Confirm booking',
      submitting: 'Booking…',
      /**
       * Both sentences say *may*, never *will* (F5). This screen cannot know:
       * the server decides with `payments.enabled() && business.requiresDeposit()`
       * and only the second half is on any public payload.
       */
      depositMaybe:
        'If a deposit is required you will be sent to a secure checkout after this step.',
      depositMaybePercent:
        'If a deposit is required, it is {percent}% of the price and you will be sent to a secure checkout after this step.',
    },
    confirmation: {
      title: 'You are booked',
      /** `{business}` is tenant data and is not translated. */
      subtitle: '{business} has your appointment. Nothing else to do.',
      linkHeading: 'Your link to this booking',
      linkBody:
        'Keep this. It is the only way back to this appointment — to check it or to cancel it — and it does not expire.',
      linkLabel: 'Your booking link',
      emailNote:
        'The same link is in the confirmation email we have just sent, along with a calendar file you can add to your own calendar.',
      manage: 'Manage this booking',
      backTo: 'Back to {business}',
    },
    payment: {
      heading: 'The deposit',
      notRefunded: 'Deposits are not refunded if you cancel.',
      pay: 'Pay the deposit',
      polling: 'Checking for your payment…',
      gaveUp: 'Still not confirmed. If you have paid, it may take another moment.',
      checkAgain: 'Check again',
      checking: 'Checking…',
    },
    handoff: {
      title: 'One more step: the deposit',
      subtitle: '{business} takes a deposit for this booking. Your slot is held while you pay.',
      /** D7 in words, before the click rather than after it. */
      notRefunded:
        'The deposit is not refunded if you cancel, even within the cancellation window.',
      checkout: 'Continue to secure checkout',
      checkoutNote: 'You will be taken to Stripe to pay.',
      unavailable:
        'We could not open the payment page just now. Your booking exists and the slot is held — open it below to try again.',
      openBooking: 'Open your booking',
      fallbackHeading: 'If anything goes wrong',
      fallbackBody:
        'This link comes back to your booking whether or not the payment goes through. It is in your email too.',
    },
    cancel: {
      sectionHeading: 'Cannot make it?',
      /** `{when}` is a day and a clock already joined on the salon's clock. */
      until: 'You can cancel online until {when}.',
      tooLate:
        'The deadline to cancel online was {when}. Please contact the business — they can still cancel it for you.',
      open: 'Cancel this booking',
      dialogTitle: 'Cancel this booking?',
      dialogBody:
        'Your {when} appointment will be given back to the calendar. This cannot be undone — booking again means finding a free time.',
      notRefunded:
        'Deposits are not refunded. If you paid a deposit for this booking, cancelling does not return it.',
      cutoffTitle: 'It is too late to cancel this online.',
      cutoffBody:
        'The deadline was {when}. Please contact the business directly — they can still cancel it for you.',
      keep: 'Keep my booking',
      confirm: 'Yes, cancel it',
      cancelling: 'Cancelling…',
    },
    flow: {
      loading: 'Loading this business',
      errorTitle: 'This booking page could not be loaded',
      /** The h1 of each step. The question the step is asking. */
      stepService: 'What are you booking?',
      stepStaff: 'Who would you like?',
      stepSlot: 'When suits you?',
      stepDetails: 'Who is this for?',
      alreadyBooked: 'You have already booked this slot in this tab.',
      alreadyStarted: 'You already started a booking in this tab.',
      openIt: 'Open it',
      /** The line under the picker: name, duration, price, joined by the page. */
      serviceLine: '{name} · {duration} · {price}',
      /** The stepper's line under an answered service step. */
      serviceAndDuration: '{name} · {duration}',
      onlyOne: 'the only one for this service',
    },
    landing: {
      loading: 'Loading this business',
      errorTitle: 'This page could not be loaded',
      eyebrow: 'Book an appointment',
      book: 'Book an appointment',
      /** `{city}` is an IANA city name and is not prose. */
      cityAndCount: '{city} · {count}',
      serviceCount: { one: '{count} service', other: '{count} services' },
      services: 'Services',
      openingHours: 'Opening hours',
      depositMaybe: 'A deposit may be requested when you confirm.',
      depositMaybePercent: 'A {percent}% deposit may be requested when you confirm.',
    },
    manage: {
      heading: 'Your booking',
      loading: 'Loading your booking',
      notFoundTitle: 'We could not find that booking',
      notFoundBody:
        'The link may be incomplete, or it may belong to a booking that was removed. Check the link in your confirmation email — it is the full one.',
      goHome: 'Go to the booking page',
      errorTitle: 'Your booking could not be loaded',
      stale: 'We could not check for an update just now. What is below is the last answer we had.',
      retry: 'Try again',
      checking: 'Checking…',
      bookedBy: 'Booked by',
      /** `{from}` and `{to}` are clocks; the day comes first in both languages. */
      whenRange: '{date} at {from} – {to}',
      /** This page has no business in its payload, so it shows the viewer's clock. */
      viewerZone: 'Times shown in your own time zone ({abbreviation}).',
      linkHeading: 'Your link to this booking',
      linkBody:
        'This is the page you are on. Keep it — it does not expire, and it is the only way back to this appointment.',
      status: {
        pendingTitle: 'Waiting for your deposit',
        pendingBody:
          'Your slot is held until the deposit is paid. Nobody else can take it in the meantime.',
        confirmedTitle: 'Your booking is confirmed',
        confirmedBody: 'You are expected. Nothing else to do.',
        cancelledTitle: 'This booking was cancelled',
        cancelledBody:
          'The time has gone back into the calendar. This link keeps working, so you can always check what it was.',
        completedTitle: 'This appointment is done',
        completedBody: 'It was marked completed by the business.',
        noShowTitle: 'Recorded as a no-show',
        noShowBody:
          'The business marked this appointment as missed. If that is wrong, contact them — they can correct it.',
        expiredTitle: 'This hold has expired',
        expiredBody:
          'The deposit was not paid in time, so the slot has gone back into the calendar. This booking will be cancelled shortly.',
      },
    },
    failure: {
      /** The generic heading over a booking that did not go through. */
      title: 'This booking could not be completed',
      slotTakenTitle: 'That time was taken while you were filling this in',
      slotTakenBody:
        'Someone else booked it a moment ago. Your details are kept — choose another time and we will try again.',
      leadTimeTitle: 'That is sooner than this business takes bookings',
      leadTimeBody: 'The earliest they can take you is {when}. The times below start there.',
      leadTimeVague: 'They need more notice than that. Please choose a later time.',
      maxAdvanceTitle: 'That is further ahead than this business takes bookings',
      maxAdvanceBody: 'The latest they can take you is {when}. The times below end there.',
      maxAdvanceVague:
        'They do not take bookings that far in advance. Please choose an earlier time.',
      staleTitle: 'That time is no longer on offer',
      staleBody: 'The times on screen were out of date. Here is what this business has free now.',
      serviceInactiveTitle: 'That service is no longer bookable',
      serviceInactiveBody:
        'This business stopped offering it while you were booking. Everything else it does is below.',
      staffTitle: 'Nobody here performs that service at the moment',
      staffBody:
        'The team changed while you were booking. Choose another service, or try again later.',
      rateLimitedTitle: 'Too many booking attempts from here',
      rateLimitedBody: 'Wait {window} and try again. Your details are kept.',
      /** `Intl.PluralRules` picks the form; French counts 0 with the singular. */
      retrySeconds: { one: '{count} second', other: '{count} seconds' },
      retryMinutes: { one: '{count} minute', other: '{count} minutes' },
      retryVague: 'a few minutes',
    },
    heldUntil: 'Held until {time}',
    slotCount: { one: '{count} time', other: '{count} times' },
  },
} as const
