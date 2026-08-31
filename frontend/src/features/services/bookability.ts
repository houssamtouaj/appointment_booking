import type { Lookups } from '@/hooks/use-lookups'
import type { Service, Staff } from '@/types'

/**
 * The three states a catalogue row can be in, and the reason for the awkward one.
 *
 * This is the wave's central idea and its most useful five minutes of work.
 * `bookable` is computed server-side as *active **and** at least one **active**
 * staff member assigned*, so a service can be switched on, priced, buffered, and
 * still produce exactly no slots because nobody performs it. On the public page
 * that failure is completely silent — the service is listed and simply offers no
 * times. The API answers the question already; all that is missing is a screen
 * that asks it.
 *
 * Hence **three** row states rather than the two an `active` flag suggests, and
 * the gate item that goes with them: an active service with `bookable: false`
 * must never render the same as an archived one. They are different problems.
 * One is a service the owner switched off on purpose; the other is a service the
 * owner believes is selling.
 */

export type BookableState = 'bookable' | 'unbookable' | 'archived'

export type Bookability = {
  state: BookableState
  /** The chip's own word. Sentence case, because it sits in a row of prose. */
  label: string
  /**
   * Why it is not bookable, in one sentence, or `undefined` for the two states
   * that need no explanation.
   *
   * Always a complete sentence and never a fragment: it is read out as the
   * chip's description, and "no active staff" is a log line rather than
   * something to say to a person.
   */
  reason?: string
}

/**
 * The row state, from the service and the team.
 *
 * `bookable` is taken from the server and never recomputed — the reason is
 * derived locally, but the *verdict* is not. Recomputing it here would put a copy
 * of a domain rule in the client (rule 1) and would be wrong the moment the
 * lookups are a minute stale, which is precisely when somebody is looking at
 * this screen after editing the team on the other one.
 */
export function bookabilityOf(service: Service, lookups: Lookups): Bookability {
  if (!service.active) {
    return {
      state: 'archived',
      label: 'Archived',
      // No reason: this one is not a problem. It is a decision, and the row's
      // Reactivate button is the whole story.
    }
  }

  if (service.bookable) {
    return { state: 'bookable', label: 'Bookable' }
  }

  return {
    state: 'unbookable',
    label: 'Not bookable',
    reason: unbookableReason(service, lookups),
  }
}

/**
 * Which of the two silences this is.
 *
 * `serviceSchema` names three causes of `bookable: false` and one of them —
 * inactive — is already the archived branch above. The remaining two want
 * different sentences because they want different actions: nobody assigned is
 * fixed here, and everybody assigned having left is fixed on the team screen or
 * by assigning somebody else.
 */
function unbookableReason(service: Service, lookups: Lookups): string {
  if (service.staffIds.length === 0) {
    return 'Nobody is assigned to perform it, so it offers no times on your booking page.'
  }

  const assigned = performersOf(service, lookups)
  const departed = assigned.filter((person) => !person.active)

  // Anything short of "every id resolved, and every one of them is deactivated"
  // is not a cause this can name. The lookups have not answered yet, or answered
  // without somebody this service names, or still show an assignee as active —
  // and naming a person as departed on a stale cache prints a sentence about a
  // colleague that is simply untrue. So this says what is certainly true and no
  // more.
  if (assigned.length !== service.staffIds.length || departed.length !== assigned.length) {
    return 'It offers no times on your booking page. Assign a colleague who is still active.'
  }

  const names = departed.map((person) => person.fullName).join(', ')
  return departed.length === 1
    ? `${names} is the only person assigned to it, and they have been deactivated.`
    : `Everyone assigned to it has been deactivated: ${names}.`
}

/**
 * The colleagues assigned to a service, in the order the roster shows them.
 *
 * Sorted by name rather than left in `staffIds` order, which is the order rows
 * came out of the join table — arbitrary, and different between two services
 * with the same two performers. A list of avatars that reorders itself between
 * rows reads as a rendering bug.
 *
 * An id the lookups cannot resolve is **dropped rather than rendered**. It means
 * one of two things: the reference cache has not loaded, or the catalogue names
 * somebody outside it — and a monogram built from "Unknown colleague" would be a
 * grey `UN` circle on the row, which looks like a person who does not exist.
 */
export function performersOf(service: Service, lookups: Lookups): Staff[] {
  return service.staffIds
    .map((id) => lookups.staffById.get(id))
    .filter((person): person is Staff => person !== undefined)
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
}

/**
 * Who the chip can offer to assign: active, and not already on this service.
 *
 * Deactivated colleagues are excluded because assigning one would not make the
 * service bookable — it would leave the row exactly as it is, having taken an
 * action, which is the worst possible answer to "why is this not bookable".
 */
export function assignableTo(service: Service, lookups: Lookups): Staff[] {
  const assigned = new Set(service.staffIds)
  return [...lookups.staffById.values()]
    .filter((person) => person.active && !assigned.has(person.id))
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
}
