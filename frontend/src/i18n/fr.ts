import type { en } from '@/i18n/en'
import type { Same } from '@/i18n/index'

/**
 * Every French string, in the shape of `en`.
 *
 * `satisfies Same<typeof en>` is the whole reason this is hand-written (F21): a
 * key missing here, or a key here that `en` does not have, is a build failure
 * rather than an English sentence in a French page. It is `satisfies` and not a
 * type annotation so that the literal types survive for anything that wants them.
 *
 * `switchTo` and `groupLabel` are the exception to translating everything: the
 * button that leaves French is labelled in the language it leads to, because
 * somebody who cannot read this page is exactly who needs to find it.
 */
export const fr = {
  common: {
    cancel: 'Annuler',
    back: 'Retour',
    signIn: 'Connexion',
    signOut: 'Déconnexion',
    signingOut: 'Déconnexion…',
    durationHoursMinutes: '{hours} h {minutes} min',
    durationHours: '{hours} h',
    durationMinutes: '{minutes} min',
  },
  language: {
    switchTo: 'Passer en français',
    groupLabel: 'Langue',
  },
  booking: {
    heldUntil: "Réservé jusqu'à {time}",
    slotCount: { one: '{count} horaire', other: '{count} horaires' },
  },
} satisfies Same<typeof en>
