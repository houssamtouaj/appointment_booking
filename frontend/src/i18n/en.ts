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
