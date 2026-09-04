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
    /** Pagination and one-word actions, shared once they were needed twice. */
    previous: 'Previous',
    next: 'Next',
    today: 'Today',
    done: 'Done',
    edit: 'Edit',
    deactivate: 'Deactivate',
    reactivate: 'Reactivate',
    signIn: 'Log in',
    signOut: 'Sign out',
    signingOut: 'Signing out…',
    /** `{hours}` and `{minutes}` come from `splitDuration` — see Task 5. */
    durationHoursMinutes: '{hours} hr {minutes} min',
    durationHours: '{hours} hr',
    durationMinutes: '{minutes} min',
    /**
     * What the reference lookups say when they miss. Five features read them —
     * the booking list, the tile, the sheet, the calendar columns and the
     * dashboard's upcoming list — so they are `common` rather than any one
     * screen's.
     */
    unknownService: 'Unknown service',
    unknownColleague: 'Unknown colleague',
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
    /**
     * `passwordSchema`'s two messages, shared by register, reset and accept —
     * one schema, so one pair of keys rather than one pair per screen.
     *
     * The numbers are written into the copy rather than interpolated from
     * `PASSWORD_MIN_LENGTH`/`PASSWORD_MAX_BYTES`, matching `passwordHint` three
     * keys below, which has always done the same. Threading variables through
     * would mean every one of the three screens that resolves this message
     * knowing which variables it wants.
     */
    password: {
      tooShort: 'Must be at least 8 characters',
      /** Bytes, not characters: BCrypt reads 72 of them and the backend refuses more. */
      tooLong: 'Must be at most 72 bytes — some characters count as two or three',
    },
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
      /**
       * `loginRequestSchema`'s two messages. Deliberately "enter one" and never
       * "that is not a valid password" — a sign-in form that describes the
       * password rules is a quiet account-enumeration oracle.
       */
      emailRequired: 'Enter your email address',
      passwordRequired: 'Enter your password',
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
      /**
       * The one message on this form with no `errors.field*` twin: the 422 path
       * only ever reports the *shape* of a slug, and an empty one never leaves
       * the browser.
       */
      slugRequired: 'Enter a URL slug',
      timezone: 'Timezone',
      timezoneHint: 'Every time in the product is shown in it.',
      currency: 'Currency',
      currencyHint: 'Three letters, ISO 4217.',
      currencyShape: 'Use a three-letter ISO 4217 code, like EUR',
      fullName: 'Your name',
      email: 'Email',
      emailTaken: 'An account already exists for this address.',
      password: 'Password',
      passwordHint: 'At least 8 characters.',
      submit: 'Create business',
      submitting: 'Creating…',
      /** `{name}` is the business the owner just named. Tenant data, untranslated. */
      ready: '{name} is ready',
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
      /** The line the link below sits in. One key, so French may reorder it. */
      expiredPrompt: 'Link expired?',
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
      /**
       * The two endings, and `reused` is its own sentence deliberately: being
       * signed out because somebody replayed a refresh token is a different
       * event from a session quietly running out, and the wave gate asked for
       * the difference to be sayable.
       */
      reused: 'You were signed out because your session was used from somewhere else.',
      expired: 'Your session expired. Please sign in again.',
      /** `useSignOut`'s toast. A plain hook, so it reads the module store. */
      signedOut: 'Signed out',
    },
  },
  /**
   * The admin shell's own eyebrow, shared by every admin screen's `PageHeader`.
   * In `common` rather than under a screen because six screens use it.
   */
  admin: {
    eyebrow: 'Admin',
  },
  dashboard: {
    title: 'Dashboard',
    /** `{business}` is tenant data and is not translated. */
    descriptionOwner: 'Every appointment at {business}.',
    descriptionStaff: 'Your own appointments. An owner sees the whole business on this screen.',
    errorTitle: 'This week’s figures could not be loaded',
    bandLabel: 'Figures for the week shown',
    bandLoading: 'Loading this week’s figures',
    upcomingHeading: 'Next five appointments',
    upcomingLoading: 'Loading the next appointments',
    upcomingEmptyTitle: 'No appointments scheduled',
    upcomingEmptyBody:
      'Nothing is booked from here on. The booking page is where the next one comes from.',
    openBookingPage: 'Open the booking page',
    upcomingErrorTitle: 'The appointment list could not be loaded',
    previousWeek: 'Previous week',
    nextWeek: 'Next week',
    thisWeek: 'This week',
    figures: {
      /**
       * The definitions are the deliverable as much as the figures are — two of
       * them are claims about money that have to be worded carefully, and the
       * French has to be as careful. "Revenue earned", never "Revenue"; deposits
       * held are deliberately not a subset of it.
       */
      today: 'Today',
      todayDefinition: 'Confirmed appointments starting today, whichever week is shown.',
      bookings: 'Appointments',
      bookingsDefinition: 'Confirmed and completed in the week shown. Cancellations never count.',
      revenue: 'Revenue earned',
      revenueDefinition:
        'Completed appointments only. An appointment still to come has not earned yet.',
      deposits: 'Deposits held',
      depositsDefinition:
        'Paid on appointments in the week that were not cancelled, including future ones.',
      noShows: 'No-shows',
      noShowsDefinition: 'Missed appointments as a share of the ones that have finished.',
      /**
       * What `noShowRate: null` renders as. A business with nothing completed has
       * no no-show rate, and "0%" would tell an owner they have a perfect record
       * when what they have is no data.
       */
      notEnoughData: 'Not enough data',
    },
  },
  calendar: {
    title: 'Calendar',
    /** `{business}` is tenant data; `{city}` is an IANA city name. Neither is prose. */
    description: 'Every appointment at {business}, in {city} time.',
    /**
     * A column's spoken name: the weekday, the date, how full it is, and whether
     * it is today. The count is *only* in the label — seven counts across the top
     * is a row of numbers competing with the dates, and the column underneath
     * already shows how full it is. A screen reader has no such view.
     */
    columnLabel: '{weekday} {date}, {count}',
    columnLabelToday: '{weekday} {date}, {count}, today',
    /**
     * The day view's column, which is a colleague rather than a date. `{name}`
     * is a person's own name and `{count}` is already a phrase from
     * `countPhrase`, so this is the same shape as `columnLabel` next door.
     */
    staffColumnLabel: '{name}, {count}',
    /** `Intl.PluralRules` picks the form; French counts 0 with the singular. */
    appointmentCount: { one: '{count} appointment', other: '{count} appointments' },
    noAppointments: 'no appointments',
    loadingWeek: 'Loading this week’s appointments',
    loadingAppointment: 'Loading this appointment',
    emptyColumn: 'No appointments',
    view: {
      label: 'Calendar view',
      week: 'Week',
      day: 'Day',
      list: 'List',
      weekUnavailable: 'The week grid needs a wider screen',
    },
    /** `{unit}` is the day-or-week noun below, so the two agree in gender in French. */
    /**
     * Four flat keys, not two templates over a `{unit}` noun.
     *
     * "Previous {unit}" filled from "day"/"week" is English grammar assumed to
     * be universal: French agrees the adjective with the noun's gender, so one
     * template can only be right for one of the two — the wave shipped
     * "{unit} précédent(e)", which is wrong twice and reads the "(e)" aloud.
     * `dashboard.previousWeek` next door was already this shape.
     */
    previousDay: 'Previous day',
    nextDay: 'Next day',
    previousWeek: 'Previous week',
    nextWeek: 'Next week',
    filters: {
      everyone: 'Everyone',
      anyStatus: 'Any status',
      byColleague: 'Filter by colleague',
      byStatus: 'Filter by status',
      clear: 'Clear filters',
    },
    empty: {
      filteredTitle: 'Nothing matches these filters this week',
      filteredBody:
        'There may be appointments this week for other colleagues, or with a different status.',
      neverTitle: 'No appointments anywhere yet',
      neverBody:
        'Nothing is booked before or after this week either. The booking page is where the first one comes from.',
      openBookingPage: 'Open the booking page',
      /** `{day}` is a formatted day heading, already in the reader's language. */
      goToDay: 'Go to {day}',
      weekTitle: 'Nothing booked this week',
      weekBody:
        'The week is free. Jump to the nearest week that has appointments, or use the arrows to look around.',
      findNearest: 'Find the nearest week',
      looking: 'Looking…',
      dayTitle: 'Nothing booked on this day',
      dayBodyElsewhere: 'This day is free. There are appointments elsewhere this week.',
      dayBodyAlone: 'This day is free, and so is the rest of this week.',
    },
    sheet: {
      fallbackTitle: 'Appointment',
      loading: 'Loading this appointment’s details.',
      errorTitle: 'This appointment could not be loaded',
      when: 'When',
      date: 'Date',
      appointment: 'Appointment',
      blocked: 'Blocked out',
      /** `{buffers}` is the before/after phrase below. */
      blockedBuffered:
        'The appointment plus {buffers} — this is what the calendar lost, and it is why a nearby slot may be unavailable.',
      blockedPlain: 'This service has no buffers, so the blocked range is the appointment itself.',
      buffersBoth: '{before} before and {after} after',
      buffersBefore: '{before} before',
      buffersAfter: '{after} after',
      what: 'What',
      service: 'Service',
      with: 'With',
      guest: 'Guest',
      name: 'Name',
      email: 'Email',
      phone: 'Phone',
      notes: 'Notes',
      money: 'Money',
      price: 'Price',
      depositPaid: 'Deposit paid',
      outstanding: 'Outstanding',
      outstandingNote: 'Still to collect at the appointment.',
      agreed: 'Agreed',
      agreedNote:
        'The price and buffers above are the ones in force when this booking was made, not today’s.',
    },
    /**
     * A tile's spoken name. One key, because English says "with" where French
     * says "avec" in a different position, and the times sit in the middle.
     */
    tileLabel: '{guest}, {service} with {staff}, {from} to {to}, {status}',
    status: {
      confirmed: 'Confirmed',
      confirmedMeaning: 'Booked and paid for as far as it needs to be. It holds its slot.',
      pending: 'Awaiting deposit',
      pendingMeaning: 'A deposit is in flight. It holds its slot until the hold expires.',
      completed: 'Completed',
      completedMeaning: 'The appointment happened. It counts towards revenue earned.',
      cancelled: 'Cancelled',
      cancelledMeaning: 'Cancelled. The slot went back to the calendar immediately.',
      noShow: 'No-show',
      noShowMeaning: 'The customer did not arrive. It counts towards the no-show rate.',
    },
    transition: {
      /** `{status}` is a status word, lower-cased by the caller where the language allows it. */
      marked: 'Marked {status}.',
      refused: 'A {from} booking cannot be marked {to}.',
      tooEarlyCompleted: 'An appointment can be marked completed once it has finished.',
      tooEarlyNoShow: 'A no-show can only be recorded once the appointment was due to start.',
    },
    lookupsErrorTitle: 'The calendar could not resolve its names',
    tooManyTitle: 'This week has more appointments than the calendar can show',
    weekErrorTitle: 'This week could not be loaded',
  },
  services: {
    title: 'Services',
    /** `{business}` is tenant data and is not translated. */
    description: 'What {business} sells, how long each one takes and who performs it.',
    errorTitle: 'Your services could not be loaded',
    filterLabel: 'Filter services',
    newService: 'New service',
    loading: 'Loading your services',
    firstPage: 'First page',
    backToActive: 'Back to active services',
    lookupsWarning:
      'Your team could not be loaded, so these rows cannot show who performs each service.',
    lookupsRetry: 'Try again',
    tabs: {
      active: 'Active',
      archived: 'Archived',
      all: 'All',
    },
    empty: {
      offPageTitle: 'There is nothing on this page',
      offPageBody: 'The list is shorter than it was. Go back to the first page.',
      archivedTitle: 'Nothing is archived',
      archivedBody:
        'Services you deactivate land here. They keep their bookings and can be brought back.',
      activeTitle: 'No services yet',
      allTitle: 'Your catalogue is empty',
      body: 'A service is one thing you sell: what it is called, how long it takes and what it costs. Nothing can be booked until there is one.',
    },
    bookability: {
      archived: 'Archived',
      bookable: 'Bookable',
      unbookable: 'Not bookable',
      /**
       * The chip's whole spoken name: the state, then why, then what pressing it
       * does. `{state}` is the visible label — a complete sentence rather than a
       * fragment starting ". " that the component glued behind whatever was
       * already there, which fixed the order of three clauses in English.
       */
      chipHint: '{state}. {reason} Open to fix it.',
      assignStaff: 'Assign staff',
      /** The link under {@link nobodyActive}, which is a destination and not half a sentence. */
      goToTeam: 'Go to your team',
      noneAssigned: 'Nobody is assigned to perform it, so it offers no times on your booking page.',
      assignActive:
        'It offers no times on your booking page. Assign a colleague who is still active.',
      /**
       * Shown when the candidate list is empty, which can only mean the whole
       * active team is empty — the server has already said no *active* colleague
       * is assigned, so an empty list is never "they are all already on it".
       */
      nobodyActive:
        'Nobody on your team is active, so there is no one to assign. Reactivate a colleague, or invite somebody new.',
      /** `{names}` is a list of people's own names and is not translated. */
      onlyPersonGone: '{names} is the only person assigned to it, and they have been deactivated.',
      everyoneGone: 'Everyone assigned to it has been deactivated: {names}.',
    },
    row: {
      nobodyAssigned: 'Nobody assigned',
      /**
       * The timing line's other two segments. The duration beside them has been
       * worded by `i18n/duration.ts` since this wave began, so leaving these two
       * as templates made half a line switch language and half of it not.
       *
       * `{minutes}` stays minutes rather than going through `formatDurationText`
       * — the row is dense and "blocks 75 min" is shorter than "blocks 1 hr
       * 15 min" — and "min" is the abbreviation in both languages.
       */
      buffers: '+{before} before / +{after} after',
      blocks: 'blocks {minutes} min',
      /** `{names}` is a list of people's own names and is not translated. */
      performedBy: 'Performed by {names}',
    },
    /**
     * What a mutation says when it lands. `{name}` is a service's own name and
     * is tenant data, so it stays in whatever language the catalogue is written
     * in — which is why every one of these is a sentence with a hole in it and
     * not two strings joined.
     */
    toast: {
      /** Says where it went: the row has just left the tab it was on. */
      archived: '{name} is archived. It is under Archived and off your booking page.',
      reactivated: '{name} is back in the catalogue.',
      bookableNow: '{name} is bookable now.',
      assignedStillUnbookable:
        'Assigned. {name} is still not bookable — everyone on it is deactivated.',
      created: '{name} is on your booking page.',
      createdUnbookable: '{name} is saved. It is not bookable yet — nobody is assigned to it.',
      updated: '{name} is updated.',
    },
    form: {
      editTitle: 'Edit service',
      newTitle: 'New service',
      /** `{name}` is the service's own name — tenant data, so it is a hole and not a join. */
      editDescription: 'What {name} is, how long it takes and who performs it.',
      newDescription: 'What you sell, how long it takes and who performs it.',
      save: 'Save changes',
      create: 'Create service',
      saving: 'Saving…',
      name: 'Name',
      descriptionLabel: 'Description',
      descriptionHint: 'Shown to customers on your booking page. Optional.',
      duration: 'Duration',
      /** `{min}`, `{max}` and `{step}` come from the schema's own constants. */
      durationHint: 'In minutes. {min}–{max}, in steps of {step}.',
      price: 'Price ({currency})',
      priceHintEditing:
        'Existing bookings keep the price they were taken at. Changing this only affects new ones.',
      buffers: 'Buffers',
      before: 'Before',
      after: 'After',
      blockPrompt: 'Enter a duration to see how much of the calendar one appointment takes.',
      /** `{duration}` is already worded by `i18n/duration.ts`. */
      blockTotal: 'One appointment blocks {duration} of the calendar.',
      performers: 'Who performs it',
      performersNote: 'A service with nobody assigned offers no times, however it is priced.',
      buffersNote:
        'Setup and cleanup time. Blocks the calendar, is not charged, and is what stops the next appointment starting too early.',
      nobodyTitle: 'Nobody is assigned to perform this',
      nobodyBody:
        'It will be listed on your booking page and offer no times at all, with nothing on the page to say why. Tick a colleague above, or save it anyway and fix it from the row.',
      saveAnyway: 'Save without anyone assigned',
      loadingTeam: 'Loading your team…',
      noTeamYet: 'You have not invited anyone yet.',
      staffGone:
        'One of those colleagues is no longer part of this business. Reload the page and pick again.',
      /** The Zod messages. Keys, not sentences: a module-scope schema captures
          the language at import time and then never updates. */
      nameRequired: 'Give the service a name',
      nameTooShort: 'Use at least two characters',
      nameTooLong: 'Keep it under 120 characters',
      descriptionTooLong: 'Keep it under 2000 characters',
      durationRequired: 'Enter how long the appointment takes',
      durationWhole: 'Enter a whole number of minutes',
      durationRange: 'Between {min} and {max} minutes',
      durationStep: 'Use a multiple of {step} minutes',
      priceRequired: 'Enter a price',
      priceShape: 'Enter a price like 12.50',
      bufferWhole: 'Enter a whole number of minutes, or leave it blank for none',
      bufferMax: 'At most {maxBuffer} minutes',
    },
  },
  team: {
    title: 'Team',
    descriptionLoading: 'Who performs the work, and what each of them can do.',
    /** Two counts in one sentence, both plural-aware. */
    description:
      '{people}, {ownership}. Deactivated colleagues and outstanding invitations are listed too.',
    peopleCount: { one: '{count} person can sign in', other: '{count} people can sign in' },
    ownerCount: { one: 'one of them an owner', other: '{count} of them owners' },
    errorTitle: 'Your team could not be loaded',
    emptyTitle: 'Nobody here yet',
    emptyBody:
      'Invite the people who take appointments. They get an email, choose their own password, and appear on the calendar.',
    owner: 'Owner',
    staff: 'Staff',
    performsNothing: 'Performs no services yet',
    loadingPerformed: 'Loading what they perform…',
    resendInvitation: 'Resend invitation',
    editAction: 'Edit',
    deactivate: 'Deactivate',
    reactivate: 'Reactivate',
    performs: 'Performs:',
    /** The tail of a truncated service list. `Intl.PluralRules` picks the form. */
    andMore: { one: 'and {count} more', other: 'and {count} more' },
    inviteColleague: 'Invite colleague',
    loading: 'Loading your team',
    standing: {
      active: 'Active',
      activeNote: 'Can sign in and take appointments.',
      deactivated: 'Deactivated',
      deactivatedNote:
        'Cannot sign in. Any appointments they already had are still in the calendar.',
      invited: 'Invited — awaiting acceptance',
      invitedNote: 'They have a link valid for seven days and choose their own password.',
      lapsed: 'Invitation lapsed',
      lapsedNote:
        'Their invitation ran out before they used it. Sending a fresh one is the only way in.',
    },
    lastOwnerTitle: 'That is the only active owner.',
    lastOwnerCopy:
      'A business must always have one active owner, or nobody could manage it. Promote another colleague to owner first.',
    /** `{name}` is a person's own name. */
    reactivated: '{name} can sign in again.',
    deactivated: '{name} is deactivated.',
    deactivatedNote: 'They have no appointments ahead of them and cannot sign in.',
    /** `{email}` is the colleague's own address. */
    resentTitle: 'A fresh invitation is on its way to {email}.',
    resentNote: 'It is valid for seven days. Any earlier link no longer works.',
    /** `{name}` is a person's own name. */
    updated: '{name} is updated.',
    warning: {
      /** `{count}` decides the plural; `{when}` is a day and clock on the salon's clock. */
      headline: '{name} has {appointments}, the next on {when}.',
      appointmentCount: {
        one: '{count} upcoming appointment',
        other: '{count} upcoming appointments',
      },
      body: 'They stay in the calendar and are not cancelled. Nobody has been told. Move them to a colleague, or bring {name} back.',
      seeAppointments: 'See their appointments',
      undo: 'Undo — reactivate them',
      undoing: 'Reactivating…',
      dismiss: 'Dismiss',
    },
    invite: {
      title: 'Invite a colleague',
      description: 'They get an email with a link and choose their own password.',
      send: 'Send invitation',
      sending: 'Sending…',
      fullName: 'Full name',
      email: 'Email address',
      /** `inviteStaffRequestSchema`'s two messages, resolved by `InviteDialog`. */
      nameRequired: 'Enter their name',
      emailShape: 'Enter a valid email address',
      emailHint: 'Where the invitation goes. It becomes how they sign in.',
      role: 'Role',
      roleHint:
        'An owner can edit the catalogue, the team and the business settings. A staff member takes appointments and sees the calendar.',
      roleStaff: 'Staff',
      roleOwner: 'Owner',
      emailTaken:
        'That address already has an account. One person can only belong to one business, so they will need a different address.',
      sentTitle: 'Invitation sent',
      inviteAnother: 'Invite someone else',
      /** `{email}` is the address that was typed. */
      sentBody: 'An email is on its way to {email} with a link that is valid for seven days.',
      sentPassword:
        'They choose their own password when they follow it — you never set one and cannot see it. Until then their row shows Invited, and you can send a fresh link from it at any time. Doing so cancels the old one.',
      /**
       * Only rendered under `import.meta.env.DEV`, and translated anyway: it is
       * inline in a shipped file, so leaving it English would mean an exception
       * in the hardcoded-string scan, and an exception costs more than two keys.
       */
      sentDevNote:
        'Running locally, that mail is not sent anywhere: Compose delivers it to MailHog on {host}.',
      /** `{name}` is a person's own name; `{role}` is `roleWordOwner`/`roleWordStaff`. */
      sentDescription: '{name} has been added to your team as {role}.',
      roleWordOwner: 'an owner',
      roleWordStaff: 'a staff member',
      sentValidity: 'The link is valid for seven days.',
      sentUntil:
        'Until then their row shows Invited, and you can send a fresh link from it at any time.',
    },
    edit: {
      title: 'Edit colleague',
      /** `{email}` is the person's own address. */
      description: '{email} — their name as it appears on the calendar, and what they can do.',
      save: 'Save changes',
      saving: 'Saving…',
      fullName: 'Full name',
      nameRequired: 'Enter their name',
      nameTooLong: 'Keep it under 120 characters',
      roleDelay:
        'Their new role takes effect the next time their session refreshes, within fifteen minutes.',
    },
  },
  hours: {
    eyebrow: 'Availability',
    ownTitle: 'Your working hours',
    /** `{name}` is a colleague's own name. */
    otherTitle: '{name}’s working hours',
    /**
     * Two whole sentences, not one with a subject-and-verb fragment dropped into
     * the middle of it. "When {who} available" filled from "you are"/"they are"
     * is a clause split at a point only English can be split at. `{city}` is an
     * IANA city name and is not prose.
     */
    descriptionOwn:
      'When you are available to be booked, in {city} time. These are wall-clock hours: nine o’clock stays nine o’clock when the clocks change.',
    descriptionOther:
      'When they are available to be booked, in {city} time. These are wall-clock hours: nine o’clock stays nine o’clock when the clocks change.',
    thisColleague: 'This colleague',
    selfOnly: 'You can only edit your own working hours.',
    loading: 'Loading the weekly hours',
    errorTitle: 'These working hours could not be loaded',
    weekly: {
      heading: 'Weekly hours',
      copyWeekdays: 'Copy Monday to weekdays',
      copyAll: 'Copy Monday to all days',
      /**
       * One key. It was two so that a `<strong>` could wrap the first half, and
       * a sentence split for emphasis is a sentence that cannot be reordered —
       * which is the one thing a translation of it has to do. The emphasis is
       * kept by styling the whole line instead.
       */
      replaces:
        'Saving replaces the whole week. Every day is sent together, so a day switched off here loses its hours — this form does not edit one day at a time.',
      fixMarked: 'Fix the marked rows before saving.',
      unsaved: 'Unsaved changes. Saving sends all seven days.',
      inSync: 'Everything here matches what is saved.',
      discard: 'Discard changes',
      save: 'Save the week',
      saving: 'Saving…',
      /** `{name}` is a colleague's own name. */
      saved: '{name}’s week is saved.',
      /**
       * `{days}` is a comma-joined list of weekday names. The verb agrees with
       * the count through `Intl.PluralRules` — this was `removals.length === 1
       * ? 'has' : 'have'`, and French agrees the verb differently and at a
       * different boundary.
       */
      removed: { one: '{days} now has no hours.', other: '{days} now have no hours.' },
    },
    day: {
      closed: 'Closed — no hours worked',
      /**
       * The shift's own ordinal label, which the three keys below take as
       * `{shift}`. A key rather than a template in `day-row.tsx`, because the
       * word "shift" is half of every one of those accessible names and leaving
       * it in English made French read "Début de lundi, shift 2".
       *
       * `{day}` is a weekday from `Intl` and is already in the right language.
       */
      shift: '{day}, shift {index}',
      /** `{shift}` is the shift's own ordinal label. */
      start: '{shift} start',
      end: '{shift} end',
      remove: 'Remove {shift}',
      add: 'Add a shift',
      addHint: 'for a split shift or a break',
      overlap:
        'These hours overlap something else in the week. Two ranges cannot claim the same minute.',
      /** `rangeProblem`'s two answers, rendered in a `role="alert"` beside the inputs. */
      bothTimes: 'Both times are needed',
      sameTimes: 'Start and end must differ',
    },
    removal: {
      /** `{day}` is one weekday name; `{count}` decides the plural. */
      oneTitle: '{day} will no longer be worked',
      manyTitle: '{count} days will no longer be worked',
      body: {
        one: 'Saving replaces the whole week, so {days} will have no hours at all and nothing can be booked on it. Existing appointments stay in the calendar.',
        other:
          'Saving replaces the whole week, so {days} will have no hours at all and nothing can be booked on them. Existing appointments stay in the calendar.',
      },
      goBack: 'Go back',
      confirm: 'Save and remove',
    },
    leave: {
      title: 'Leave without saving these hours?',
      body: 'The weekly grid has changes that have not been sent. Leaving now discards them and the saved template stays as it was.',
      keep: 'Keep editing',
      discard: 'Discard changes',
    },
    overrides: {
      heading: 'Overrides',
      eyebrow: 'One-off changes',
      subheading: 'Holidays, days off and extra hours, on top of the weekly template.',
      add: 'Add an override',
      previousMonth: 'Previous month',
      nextMonth: 'Next month',
      thisMonth: 'This month',
      loading: 'Loading overrides',
      errorTitle: 'These overrides could not be loaded',
      /** `{month}` is a formatted month name. */
      emptyTitle: 'Nothing changes in {month}',
      emptyBody:
        '{name} works the weekly hours above, every day of this month. Add an override for a holiday, a day off or a late opening.',
      blocked: 'Blocked',
      extra: 'Extra hours',
      /** The two whole-day forms, beside the date rather than instead of it. */
      closedAllDay: 'closed all day',
      allDay: 'all day',
      wholeBusiness: 'Whole business',
      /** `{date}` is a formatted day heading. */
      remove: 'Remove the override on {date}',
      setByOwner: 'Set by an owner',
      removed: 'That override is gone. Availability is back to the weekly hours.',
    },
    dialog: {
      title: 'Add an override',
      description: 'A one-off change to a single date, on top of the weekly hours.',
      save: 'Add it',
      saving: 'Saving…',
      date: 'Date',
      reason: 'Reason',
      reasonHint:
        'Shown on this list and nowhere a customer can see. “Public holiday”, “training”, “late opening”.',
      scope: 'Applies to',
      scopeBusiness: 'The whole business — everybody is closed',
      scopeStaff: '{name} only',
      effect: 'Effect',
      effectBlockedHint: 'Takes availability away. Nothing can be booked in it.',
      effectExtraHint:
        'Adds hours outside the weekly template — a late evening, a Saturday opening.',
      optionBlocked: 'Blocked — remove time',
      optionExtra: 'Extra — add time',
      wholeDay: 'The whole day',
      from: 'From',
      to: 'To',
      savedBusiness: 'The business is closed on that date for everybody.',
      /** `{name}` is a colleague's own name. */
      savedStaff: '{name}’s availability is updated for that date.',
      /** The Zod messages, as keys — see `services/service-form.ts` for why. */
      dateRequired: 'Pick a date',
      reasonTooLong: 'Keep it under 200 characters',
      bothTimes: 'Both times are needed',
      timesDiffer: 'Start and end must differ',
    },
  },
  nav: {
    sections: 'Sections',
    dashboard: 'Dashboard',
    calendar: 'Calendar',
    services: 'Services',
    team: 'Team',
    settings: 'Settings',
    workingHours: 'Working hours',
    bookingPage: 'Booking page',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    /** `{name}` is the signed-in person's own name. */
    account: 'Account: {name}',
    viewBookingPage: 'View booking page',
    theme: 'Theme',
    themeSystem: 'Match system',
    themeLight: 'Light',
    themeDark: 'Dark',
  },
  settings: {
    title: 'Settings',
    description:
      'What the business is called, the clock it runs on, and the rules every customer books against.',
    loadingBusiness: 'Loading your business settings',
    loadingPolicy: 'Loading your booking rules',
    businessErrorTitle: 'Your business settings could not be loaded',
    policyErrorTitle: 'Your booking rules could not be loaded',
    business: {
      heading: 'Business',
      name: 'Name',
      slug: 'Booking page address',
      slugHint:
        'Permanent. Changing it would break every link already sent to a customer, so there is no way to.',
      timezone: 'Timezone',
      timezoneHint:
        'Working hours are read in this zone. Changing it moves every future slot, and asks first.',
      currency: 'Currency',
      currencyHint:
        'ISO 4217, three letters. It is the unit of every price you have already set — changing it reinterprets them and converts nothing.',
      deposits: 'Deposits',
      askDeposit: 'Ask for a deposit when a customer books',
      depositPercent: 'Deposit percentage',
      depositPercentHint: '0 to 100.',
      /** One key, for the reason `hours.weekly.replaces` gives: the emphasis is on the line, not on half a sentence. */
      zero: 'A percentage of zero means no deposit, whatever the checkbox says. That is what the booking page reports too.',
      paymentsNote:
        'Deposits are taken only when payments are configured for this deployment. This setting is stored either way, and the booking response is what decides whether a customer is asked for money.',
      save: 'Save business settings',
      saving: 'Saving…',
      saved: 'Your settings are saved.',
      /** `{zone}` is an IANA zone id and is not prose. */
      movedTo: 'The business is now on {zone}.',
      movedNote: 'Every screen is now drawn in the new zone.',
      /** The Zod messages, as keys — see `services/service-form.ts` for why. */
      nameRequired: 'Enter a name',
      nameTooLong: 'Keep it under 120 characters',
      timezoneRequired: 'Enter a timezone',
      currencyShape: 'Three letters, like EUR or GBP',
      wholeNumbers: 'Whole numbers only',
      percentRange: 'Between 0 and 100',
    },
    policy: {
      heading: 'Booking rules',
      minLeadTime: 'Minimum notice (hours)',
      minLeadTimeHint:
        'The soonest someone can book. 2 hours means nothing today after 4pm for a 6pm slot.',
      maxAdvance: 'Booking window (days)',
      maxAdvanceHint: 'How far ahead the calendar is open.',
      cutoff: 'Cancellation cutoff (hours)',
      cutoffHint: 'After this, a customer can no longer cancel themselves.',
      slotStep: 'Slot step',
      slotStepHint: 'The step between offered start times.',
      incomplete: 'Fill in all four numbers to see what customers will be offered.',
      stepNote:
        'Changing the slot step does not move appointments that are already booked. Some may sit off the new grid, which is expected.',
      save: 'Save booking rules',
      saving: 'Saving…',
      saved: 'Your booking rules are saved.',
      wholeHours: 'Whole hours only',
      wholeDays: 'Whole days only',
      hoursRange: 'Between 0 and 168',
      daysRange: 'Between 1 and 365',
      /**
       * The four numbers said back as one sentence, so an owner can recognise it
       * as wrong. `{lead}`, `{window}` and `{step}` are the three phrases below.
       */
      summary: 'Customers can book {lead} up to {window} out, in {step}-minute steps.',
      leadImmediate: 'right up to the start time',
      leadAhead: 'from {hours} ahead',
      hourCount: { one: '{count} hour', other: '{count} hours' },
      dayCount: { one: '{count} day', other: '{count} days' },
      cutoffImmediate: 'They can cancel themselves right up to the start time.',
      cutoffBefore:
        'They can cancel themselves until {hours} before the appointment; after that, only you can.',
    },
    timezone: {
      /** `{to}` and `{from}` are IANA zone ids and are not prose. */
      title: 'Move the business to {to}?',
      body: 'Every future slot moves with it. Working hours are wall-clock times read in the business timezone, so “we open at nine” will mean nine o’clock in {to} instead of nine o’clock in {from}.',
      now: 'Now',
      after: 'After saving',
      /** `{bookings}` is one of the three sentences below. */
      footnote:
        '{bookings} Nothing is rescheduled and no appointment is moved — each one keeps its wall-clock time in the new zone.',
      bookingsUnknown: 'Appointments already in the calendar are affected.',
      bookingsNone: 'There are no future appointments in the calendar right now.',
      bookingsCount: {
        one: '{count} future appointment is in the calendar.',
        other: '{count} future appointments are in the calendar.',
      },
      keep: 'Keep {from}',
      move: 'Move to {to}',
      saving: 'Saving…',
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
    /**
     * The theme button's accessible name, which says what pressing it will *do*
     * rather than what the current state is — a button named "Dark" is ambiguous
     * about whether that is the state or the destination, and a screen-reader
     * user has no icon to disambiguate it.
     */
    themeToggle: {
      toLight: 'Switch to light theme',
      toDark: 'Switch to dark theme',
      toSystem: 'Use system theme',
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
      /**
       * `bookingRequestSchema`'s messages. This is the highest-traffic form in
       * the product and the one where the reader is least likely to be an
       * English speaker: a customer reaching step 4 of `/b/<slug>` in French
       * used to read "Please tell us your name" under "Votre nom".
       *
       * `tooLong` is one key for three fields — name, email and phone all cap at
       * a different number and say the same thing, and the number is not in the
       * sentence.
       */
      nameRequired: 'Please tell us your name',
      emailRequired: 'We need an address to send your confirmation to',
      emailShape: 'That does not look like an email address',
      tooLong: 'That is too long',
      notesTooLong: 'Please keep this under 2000 characters',
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
