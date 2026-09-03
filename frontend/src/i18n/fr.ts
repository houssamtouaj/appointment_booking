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
  auth: {
    eyebrow: 'Compte',
    login: {
      title: 'Connexion',
      description: 'Gérez votre agenda, vos prestations et votre équipe.',
      noAccount: 'Pas encore de compte ?',
      createBusiness: 'Créer une entreprise',
      demo: 'Se connecter au compte de démonstration',
      demoNote:
        'Vous connecte à une entreprise de démonstration avec prestations, équipe et réservations. Rien de ce que vous y faites n’est permanent.',
      or: 'ou',
      email: 'Adresse e-mail',
      password: 'Mot de passe',
      submit: 'Se connecter',
      submitting: 'Connexion…',
      forgot: 'Mot de passe oublié ?',
      welcome: 'Connecté en tant que {name}',
    },
    register: {
      title: 'Créer une entreprise',
      haveAccount: 'Vous avez déjà un compte ?',
      logIn: 'Se connecter',
      description:
        'Une seule étape. Vous obtenez un compte propriétaire, un agenda vide et une page de réservation publique.',
      businessName: "Nom de l'entreprise",
      slug: 'Adresse de la page de réservation',
      slugHint:
        "Lettres, chiffres et tirets. C'est définitif — c'est l'URL que vos clients mettront en favori.",
      slugTaken: 'Cette adresse est prise. Essayez-en une autre.',
      timezone: 'Fuseau horaire',
      timezoneHint: 'Toutes les heures du produit y sont affichées.',
      currency: 'Devise',
      currencyHint: 'Trois lettres, ISO 4217.',
      fullName: 'Votre nom',
      email: 'Adresse e-mail',
      emailTaken: 'Un compte existe déjà pour cette adresse.',
      password: 'Mot de passe',
      passwordHint: 'Au moins 8 caractères.',
      submit: "Créer l'entreprise",
      submitting: 'Création…',
    },
    forgot: {
      title: 'Réinitialiser votre mot de passe',
      description:
        'Nous vous enverrons un lien par e-mail. Il fonctionne une fois et dure une heure.',
      backToLogin: 'Retour à la connexion',
      sentTitle: 'Consultez votre boîte de réception',
      sentBody:
        "Si {email} a un compte, un lien de réinitialisation est en route. Il expire dans une heure et ne fonctionne qu'une fois.",
      sentSpam:
        "Pas d'e-mail ? Vérifiez les indésirables, puis réessayez — nous répondons de la même façon qu'un compte existe ou non, cette page ne peut donc pas vous dire lequel c'était.",
      email: 'Adresse e-mail',
      submit: 'Envoyer le lien',
      submitting: 'Envoi…',
    },
    reset: {
      title: 'Choisir un nouveau mot de passe',
      description:
        "Le définir vous déconnecte partout ailleurs — c'est à cela que sert une réinitialisation.",
      askAgain: 'En demander un nouveau',
      password: 'Nouveau mot de passe',
      passwordHint: 'Au moins 8 caractères.',
      confirm: 'Confirmez-le',
      mismatch: 'Les deux mots de passe ne correspondent pas',
      submit: 'Définir le mot de passe',
      submitting: 'Enregistrement…',
      done: 'Votre mot de passe a été changé. Connectez-vous avec.',
    },
    invitation: {
      title: "Rejoindre l'équipe",
      loading: "Chargement de l'invitation",
      consumedTitle: 'Cette invitation a déjà été utilisée',
      invalidTitle: "Cette invitation n'est pas valide",
      consumedBody:
        "Les invitations fonctionnent une fois et expirent après sept jours. Demandez à un propriétaire de l'entreprise d'en envoyer une nouvelle.",
      goToLogin: 'À la page de connexion',
      invitedBy: '{business} a invité {email}. Choisissez un mot de passe pour activer le compte.',
      fullName: 'Votre nom',
      password: 'Mot de passe',
      passwordHint: 'Au moins 8 caractères.',
      submit: "Rejoindre l'équipe",
      submitting: 'Adhésion…',
      done: 'Votre compte est prêt. Connectez-vous avec votre nouveau mot de passe.',
    },
    guards: {
      restoring: 'Restauration de votre session',
      ownerOnly: 'Équipe : cette page est réservée aux propriétaires.',
    },
    session: {
      logIn: 'Connexion',
    },
  },
  admin: {
    eyebrow: 'Admin',
  },
  dashboard: {
    title: 'Tableau de bord',
    descriptionOwner: 'Tous les rendez-vous de {business}.',
    descriptionStaff:
      'Vos propres rendez-vous. Un propriétaire voit toute l’entreprise sur cet écran.',
    errorTitle: 'Les chiffres de la semaine n’ont pas pu être chargés',
    bandLabel: 'Chiffres de la semaine affichée',
    bandLoading: 'Chargement des chiffres de la semaine',
    upcomingHeading: 'Les cinq prochains rendez-vous',
    upcomingLoading: 'Chargement des prochains rendez-vous',
    upcomingEmptyTitle: 'Aucun rendez-vous prévu',
    upcomingEmptyBody:
      'Rien n’est réservé à partir d’ici. C’est de la page de réservation que vient le prochain.',
    openBookingPage: 'Ouvrir la page de réservation',
    upcomingErrorTitle: 'La liste des rendez-vous n’a pas pu être chargée',
    previousWeek: 'Semaine précédente',
    nextWeek: 'Semaine suivante',
    thisWeek: 'Cette semaine',
    figures: {
      today: "Aujourd'hui",
      todayDefinition:
        'Rendez-vous confirmés commençant aujourd’hui, quelle que soit la semaine affichée.',
      bookings: 'Rendez-vous',
      bookingsDefinition:
        'Confirmés et réalisés dans la semaine affichée. Les annulations ne comptent jamais.',
      revenue: 'Chiffre réalisé',
      revenueDefinition:
        'Rendez-vous réalisés uniquement. Un rendez-vous à venir n’a encore rien rapporté.',
      deposits: 'Acomptes détenus',
      depositsDefinition:
        'Versés sur des rendez-vous de la semaine non annulés, y compris ceux à venir.',
      noShows: 'Absences',
      noShowsDefinition: 'Rendez-vous manqués rapportés à ceux qui sont terminés.',
      notEnoughData: 'Pas assez de données',
    },
  },
  components: {
    copyText: {
      copy: 'Copier',
      copied: 'Copié',
      copiedAnnouncement: '{label} copié',
    },
    errorState: {
      retry: 'Réessayer',
    },
    requestIdNote: {
      reference: 'Référence',
      referenceLine: 'Référence {requestId}',
    },
    modal: {
      close: 'Fermer',
    },
    skipLink: 'Aller au contenu',
    footerNote: "Une plateforme de réservation. Horaires affichés dans le fuseau de l'entreprise.",
  },
  notFound: {
    eyebrow: 'Erreur 404',
    title: 'Page introuvable',
    body: 'Le lien est peut-être incomplet. Les liens envoyés par e-mail expirent, et certains logiciels de messagerie coupent les liens longs en deux — si vous avez suivi un lien, demandez-en un nouveau.',
    action: 'Aller à la page de réservation',
  },
  language: {
    switchTo: 'Passer en français',
    groupLabel: 'Langue',
  },
  booking: {
    noServices: {
      title: "Rien n'est encore réservable ici",
      body: "Cette entreprise n'a publié aucune prestation. Revenez plus tard ou contactez-la directement.",
    },
    notFound: {
      eyebrow: 'Erreur 404',
      title: 'Aucune entreprise ici',
      body: "Rien n'est publié à /b/{slug}. Vérifiez le lien, ou demandez-en un nouveau à l'entreprise — certains logiciels de messagerie coupent les liens longs en deux.",
    },
    timezoneNote: {
      shownIn: 'Horaires affichés à l’heure de {city} ({abbreviation}).',
    },
    checkout: {
      cancelled:
        "Pas de souci — vous n'avez rien payé et votre créneau est toujours réservé. Vous pouvez reprendre ci-dessous.",
      paid: 'Merci — votre acompte est bien arrivé.',
      pending:
        'Merci. Nous attendons la confirmation de votre banque — cette page se met à jour toute seule.',
    },
    openingHours: {
      caption: "Heures d'ouverture, à l'heure locale de l'entreprise",
      today: "Aujourd'hui",
      closed: 'Fermé',
      nextDay: 'le lendemain',
    },
    summary: {
      service: 'Prestation',
      with: 'Avec',
      when: 'Quand',
      price: 'Prix',
      dateAtTime: '{date} à {time}',
    },
    stepper: {
      label: 'Étapes de la réservation',
      service: 'Prestation',
      staff: 'Qui',
      slot: 'Horaire',
      details: 'Coordonnées',
    },
    emptyWeek: {
      searchFailedTitle: "La recherche n'a pas abouti",
      exhaustedTitle: "Rien n'est réservable dans les deux prochains mois",
      exhaustedBody:
        "{business} n'a aucune disponibilité pour cette prestation dans sa fenêtre de réservation. Ses heures d'ouverture sont sur la page principale — une prestation plus courte aura peut-être plus de chances.",
      seeHours: "Voir les heures d'ouverture",
      title: 'Aucun horaire cette semaine',
      body: "Cette semaine est complète ou en dehors des heures d'ouverture. Il y a peut-être de la place plus tard.",
      search: 'Trouver la prochaine disponibilité',
      searching: 'Recherche…',
    },
    hold: {
      expired: 'Cette réservation provisoire a expiré. Le créneau est retourné à l’agenda.',
      until: 'Ce créneau est réservé jusqu’à {time} ({zone}).',
      untilWithRemaining: 'Ce créneau est réservé jusqu’à {time} ({zone}) — il reste {remaining}.',
      minutes: { one: '{count} minute', other: '{count} minutes' },
      seconds: { one: '{count} seconde', other: '{count} secondes' },
    },
    staffStep: {
      loading: 'Chargement des personnes disponibles',
      errorTitle: "L'équipe n'a pas pu être chargée",
      emptyTitle: 'Personne ne réalise cette prestation',
      emptyBody:
        "Elle n'est pas réservable pour le moment. Une autre prestation est peut-être disponible.",
      chooseAnother: 'Choisir une autre prestation',
      anyone: "N'importe qui",
      anyoneNote: 'Premier disponible — en général le plus de créneaux',
    },
    slotStep: {
      previousWeek: 'Semaine précédente',
      nextWeek: 'Semaine suivante',
      loading: 'Chargement des horaires disponibles',
      errorTitle: "Ces horaires n'ont pas pu être chargés",
      selected: 'Choisi : {when}',
      continue: 'Continuer',
    },
    details: {
      back: 'Choisir un autre horaire',
      name: 'Votre nom',
      email: 'Adresse e-mail',
      emailHint: 'Votre confirmation et le lien de gestion de la réservation y seront envoyés.',
      phone: 'Téléphone (facultatif)',
      notes: 'Quelque chose à nous signaler ? (facultatif)',
      notesHint: 'Allergies, une préférence, où se garer.',
      submit: 'Confirmer la réservation',
      submitting: 'Réservation…',
      depositMaybe:
        'Si un acompte est demandé, vous serez redirigé vers un paiement sécurisé après cette étape.',
      depositMaybePercent:
        'Si un acompte est demandé, il représente {percent} % du prix et vous serez redirigé vers un paiement sécurisé après cette étape.',
    },
    confirmation: {
      title: "C'est réservé",
      subtitle: '{business} a votre rendez-vous. Rien d’autre à faire.',
      linkHeading: 'Votre lien vers cette réservation',
      linkBody:
        "Conservez-le. C'est le seul moyen de revenir à ce rendez-vous — pour le consulter ou l'annuler — et il n'expire pas.",
      linkLabel: 'Votre lien de réservation',
      emailNote:
        "Ce même lien figure dans l'e-mail de confirmation que nous venons d'envoyer, avec un fichier à ajouter à votre agenda.",
      manage: 'Gérer cette réservation',
      backTo: 'Retour à {business}',
    },
    payment: {
      heading: "L'acompte",
      notRefunded: "Les acomptes ne sont pas remboursés en cas d'annulation.",
      pay: "Payer l'acompte",
      polling: 'Vérification de votre paiement…',
      gaveUp: 'Toujours pas confirmé. Si vous avez payé, cela peut prendre encore un instant.',
      checkAgain: 'Vérifier à nouveau',
      checking: 'Vérification…',
    },
    handoff: {
      title: "Encore une étape : l'acompte",
      subtitle:
        '{business} demande un acompte pour cette réservation. Votre créneau est retenu pendant le paiement.',
      notRefunded:
        "L'acompte n'est pas remboursé en cas d'annulation, même dans le délai d'annulation.",
      checkout: 'Continuer vers le paiement sécurisé',
      checkoutNote: 'Vous serez redirigé vers Stripe pour payer.',
      unavailable:
        "Nous n'avons pas pu ouvrir la page de paiement pour l'instant. Votre réservation existe et le créneau est retenu — ouvrez-la ci-dessous pour réessayer.",
      openBooking: 'Ouvrir votre réservation',
      fallbackHeading: 'En cas de problème',
      fallbackBody:
        'Ce lien vous ramène à votre réservation, que le paiement aboutisse ou non. Il est aussi dans votre e-mail.',
    },
    cancel: {
      sectionHeading: 'Un empêchement ?',
      until: 'Vous pouvez annuler en ligne jusqu’au {when}.',
      tooLate:
        "La date limite pour annuler en ligne était le {when}. Contactez l'entreprise — elle peut encore annuler pour vous.",
      open: 'Annuler cette réservation',
      dialogTitle: 'Annuler cette réservation ?',
      dialogBody:
        "Votre rendez-vous du {when} sera rendu à l'agenda. C'est irréversible — réserver de nouveau implique de retrouver un créneau libre.",
      notRefunded:
        "Les acomptes ne sont pas remboursés. Si vous avez versé un acompte pour cette réservation, l'annuler ne vous le rend pas.",
      cutoffTitle: 'Il est trop tard pour annuler en ligne.',
      cutoffBody:
        "La date limite était le {when}. Contactez directement l'entreprise — elle peut encore annuler pour vous.",
      keep: 'Garder ma réservation',
      confirm: 'Oui, annuler',
      cancelling: 'Annulation…',
    },
    flow: {
      loading: 'Chargement de cette entreprise',
      errorTitle: "Cette page de réservation n'a pas pu être chargée",
      stepService: 'Que réservez-vous ?',
      stepStaff: 'Avec qui ?',
      stepSlot: 'Quand cela vous convient-il ?',
      stepDetails: 'Pour qui est-ce ?',
      alreadyBooked: 'Vous avez déjà réservé ce créneau dans cet onglet.',
      alreadyStarted: 'Vous avez déjà commencé une réservation dans cet onglet.',
      openIt: 'Ouvrir',
      serviceLine: '{name} · {duration} · {price}',
      serviceAndDuration: '{name} · {duration}',
      onlyOne: 'la seule personne pour cette prestation',
    },
    landing: {
      loading: 'Chargement de cette entreprise',
      errorTitle: "Cette page n'a pas pu être chargée",
      eyebrow: 'Prendre rendez-vous',
      book: 'Prendre rendez-vous',
      cityAndCount: '{city} · {count}',
      serviceCount: { one: '{count} prestation', other: '{count} prestations' },
      services: 'Prestations',
      openingHours: "Heures d'ouverture",
      depositMaybe: 'Un acompte peut être demandé au moment de confirmer.',
      depositMaybePercent: 'Un acompte de {percent} % peut être demandé au moment de confirmer.',
    },
    manage: {
      heading: 'Votre réservation',
      loading: 'Chargement de votre réservation',
      notFoundTitle: "Nous n'avons pas trouvé cette réservation",
      notFoundBody:
        "Le lien est peut-être incomplet, ou il appartient à une réservation supprimée. Vérifiez le lien de votre e-mail de confirmation — c'est le lien complet.",
      goHome: 'Aller à la page de réservation',
      errorTitle: "Votre réservation n'a pas pu être chargée",
      stale:
        "Nous n'avons pas pu vérifier les mises à jour à l'instant. Ce qui suit est la dernière réponse obtenue.",
      retry: 'Réessayer',
      checking: 'Vérification…',
      bookedBy: 'Réservé par',
      whenRange: '{date} de {from} à {to}',
      viewerZone: 'Horaires affichés dans votre propre fuseau ({abbreviation}).',
      linkHeading: 'Votre lien vers cette réservation',
      linkBody:
        "C'est la page où vous êtes. Conservez-la — elle n'expire pas et c'est le seul moyen de revenir à ce rendez-vous.",
      status: {
        pendingTitle: 'En attente de votre acompte',
        pendingBody:
          "Votre créneau est retenu jusqu'au paiement de l'acompte. Personne d'autre ne peut le prendre entre-temps.",
        confirmedTitle: 'Votre réservation est confirmée',
        confirmedBody: 'Vous êtes attendu. Rien d’autre à faire.',
        cancelledTitle: 'Cette réservation a été annulée',
        cancelledBody:
          "L'horaire est retourné à l'agenda. Ce lien continue de fonctionner, vous pouvez donc toujours consulter ce qu'il était.",
        completedTitle: 'Ce rendez-vous est terminé',
        completedBody: "Il a été marqué comme réalisé par l'entreprise.",
        noShowTitle: 'Enregistré comme absence',
        noShowBody:
          "L'entreprise a marqué ce rendez-vous comme manqué. Si c'est une erreur, contactez-la — elle peut corriger.",
        expiredTitle: 'Cette réservation provisoire a expiré',
        expiredBody:
          "L'acompte n'a pas été payé à temps, le créneau est donc retourné à l'agenda. Cette réservation sera annulée sous peu.",
      },
    },
    failure: {
      title: "Cette réservation n'a pas pu aboutir",
      slotTakenTitle: 'Cet horaire a été pris pendant que vous remplissiez le formulaire',
      slotTakenBody:
        "Quelqu'un vient de le réserver. Vos informations sont conservées — choisissez un autre horaire et nous réessaierons.",
      leadTimeTitle: 'Ce créneau est plus proche que ce que cette entreprise accepte',
      leadTimeBody: 'Le plus tôt possible est le {when}. Les horaires ci-dessous commencent là.',
      leadTimeVague: 'Il leur faut plus de préavis. Choisissez un horaire plus tardif.',
      maxAdvanceTitle: 'Ce créneau est plus lointain que ce que cette entreprise accepte',
      maxAdvanceBody: 'Le plus tard possible est le {when}. Les horaires ci-dessous s’arrêtent là.',
      maxAdvanceVague:
        "Ils ne prennent pas de réservations aussi loin à l'avance. Choisissez un horaire plus proche.",
      staleTitle: "Cet horaire n'est plus proposé",
      staleBody:
        "Les horaires affichés n'étaient plus à jour. Voici ce que cette entreprise a de libre maintenant.",
      serviceInactiveTitle: "Cette prestation n'est plus réservable",
      serviceInactiveBody:
        'Cette entreprise a cessé de la proposer pendant votre réservation. Tout le reste est ci-dessous.',
      staffTitle: 'Personne ici ne réalise cette prestation pour le moment',
      staffBody:
        "L'équipe a changé pendant votre réservation. Choisissez une autre prestation, ou réessayez plus tard.",
      rateLimitedTitle: 'Trop de tentatives de réservation depuis cet appareil',
      rateLimitedBody: 'Attendez {window} et réessayez. Vos informations sont conservées.',
      retrySeconds: { one: '{count} seconde', other: '{count} secondes' },
      retryMinutes: { one: '{count} minute', other: '{count} minutes' },
      retryVague: 'quelques minutes',
    },
    heldUntil: "Réservé jusqu'à {time}",
    slotCount: { one: '{count} horaire', other: '{count} horaires' },
  },
} satisfies Same<typeof en>
