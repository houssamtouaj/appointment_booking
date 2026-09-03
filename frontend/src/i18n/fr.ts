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
  errors: {
    // --- Forme de la requête. Générique à dessein : voir en.ts.
    VALIDATION_FAILED: 'Certaines informations doivent être corrigées.',
    MALFORMED_REQUEST: "Le serveur n'a pas compris cette requête. Réessayez.",
    MISSING_PARAMETER: 'Une erreur est survenue de notre côté. Réessayez dans un instant.',
    METHOD_NOT_ALLOWED: 'Une erreur est survenue de notre côté. Réessayez dans un instant.',
    UNSUPPORTED_MEDIA_TYPE: 'Une erreur est survenue de notre côté. Réessayez dans un instant.',
    NOT_ACCEPTABLE: 'Une erreur est survenue de notre côté. Réessayez dans un instant.',

    // --- Résultats génériques
    NOT_FOUND: "Cet élément n'existe plus.",
    UNAUTHENTICATED: 'Veuillez vous connecter et réessayer.',
    ACCESS_DENIED: "Vous n'avez pas accès à cette ressource.",
    DATA_CONFLICT: 'Quelque chose a changé pendant votre saisie. Rechargez et réessayez.',
    RATE_LIMITED: 'Trop de tentatives. Attendez une minute et réessayez.',
    INTERNAL_ERROR: 'Une erreur est survenue de notre côté. Réessayez dans un instant.',

    // --- Identité et locataire. Le registre de l'exploitant.
    SLUG_TAKEN: 'Cette adresse est déjà utilisée. Choisissez-en une autre.',
    EMAIL_TAKEN: 'Cette adresse e-mail a déjà un compte.',
    REFRESH_REUSED: 'Votre session a été fermée par sécurité. Reconnectez-vous.',
    INVITATION_CONSUMED: 'Cette invitation a déjà été utilisée ou a expiré.',
    LAST_OWNER:
      "Une entreprise doit garder au moins un propriétaire. Nommez d'abord quelqu'un d'autre.",

    // --- Catalogue et configuration
    STAFF_NOT_IN_BUSINESS: 'Cette personne ne fait pas partie de cette entreprise.',
    HOURS_OVERLAP:
      "Ces horaires en chevauchent d'autres le même jour. Ajustez l'un des deux blocs.",
    TIMEZONE_SHIFT_UNCONFIRMED:
      'Changer le fuseau déplace tous les rendez-vous à venir. Confirmez pour continuer.',

    // --- Réservation. Le registre du client.
    SERVICE_INACTIVE: "Cette prestation n'est pas réservable pour le moment.",
    STAFF_NOT_ASSIGNED:
      "Cette personne ne réalise pas cette prestation. Choisissez quelqu'un d'autre.",
    POLICY_LEAD_TIME:
      'Ce créneau est trop proche pour cette entreprise. Choisissez un horaire plus tardif.',
    POLICY_MAX_ADVANCE:
      'Ce créneau est trop lointain pour cette entreprise. Choisissez un horaire plus proche.',
    SLOT_NOT_ON_GRID: "Cet horaire n'est plus proposé. Choisissez-en un autre.",
    SLOT_OUTSIDE_HOURS: "Cet horaire est en dehors des heures d'ouverture. Choisissez-en un autre.",
    BOOKING_SLOT_TAKEN: "Cet horaire vient d'être réservé. Choisissez-en un autre.",
    ILLEGAL_TRANSITION: 'Cette réservation a déjà évolué. Rechargez pour voir où elle en est.',
    CANCELLATION_CUTOFF:
      "Il est trop tard pour annuler en ligne. Contactez directement l'entreprise.",

    // --- Paiements
    PAYMENT_UNAVAILABLE: 'Les paiements sont momentanément indisponibles. Réessayez sous peu.',
    WEBHOOK_SIGNATURE_INVALID: 'Une erreur est survenue de notre côté. Réessayez dans un instant.',

    // --- Pas des codes
    networkFailure: 'Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.',
    unknown: 'Une erreur est survenue. Réessayez dans un instant.',
    badCredentials: 'Adresse e-mail ou mot de passe incorrect.',
    demoUnavailable:
      "Le compte de démonstration n'est pas disponible — l'API tourne sans son profil de démo.",
    bookingDetailsInvalid: 'Certaines de ces informations doivent être corrigées.',
    invitationUnrecognised:
      "Ce lien ne nous dit rien. Vérifiez que vous avez copié l'adresse complète depuis l'e-mail.",
    hoursColleagueNotYours: 'Cette personne ne fait pas partie de votre entreprise.',
    hoursOnlyYourOwn: 'Vous ne pouvez modifier que vos propres horaires.',
    hoursOverlapUnsaved: "Deux plages se chevauchent. Rien n'a été enregistré.",
    checkFieldsBelow: 'Vérifiez les champs signalés ci-dessous.',
    checkNumbersBelow: 'Vérifiez les nombres signalés ci-dessous.',
    checkAddressAndName: "Vérifiez l'adresse et le nom.",
    checkTheName: 'Vérifiez le nom.',
    ownerOnlyBusiness: "Seul un propriétaire peut modifier les réglages de l'entreprise.",
    ownerOnlyPolicy: 'Seul un propriétaire peut modifier les règles de réservation.',
    resetLinkExpired: "Ce lien n'est plus valide. Demandez-en un nouveau.",
    invitationSpent: 'Cette invitation a déjà été utilisée ou a expiré.',
    tooManyRequests: 'Trop de requêtes. Attendez une minute et réessayez.',
    fieldEmail: 'Saisissez une adresse e-mail valide.',
    fieldName: 'Saisissez un nom.',
    fieldPassword: 'Le mot de passe doit comporter au moins huit caractères.',
    fieldBusinessName: "Saisissez le nom de l'entreprise.",
    fieldSlug: 'Utilisez 3 à 40 lettres, chiffres ou tirets.',
    checkDateAndTimes: 'Vérifiez la date et les horaires.',
    hoursOnlyYourOwnDays: 'Vous ne pouvez modifier que vos propres journées.',
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
