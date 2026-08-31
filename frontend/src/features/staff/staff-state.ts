import type { Staff } from '@/types'

/**
 * `active`, `accepted` and `invitationPending` are three independent booleans,
 * and what an owner actually wants to know is one thing: *what do I click next?*
 *
 * The wave plan tables three combinations. There are four that the API can
 * produce, and the fourth is the one worth catching:
 *
 * | `active` | `accepted` | `invitationPending` | State                | Action     |
 * |----------|------------|---------------------|----------------------|------------|
 * | ✓        | ✓          | ✗                   | Active               | —          |
 * | ✗        | ✗          | ✓                   | Invited              | Resend     |
 * | ✗        | ✗          | ✗                   | **Invitation lapsed**| Resend     |
 * | ✗        | ✓          | ✗                   | Deactivated          | Reactivate |
 *
 * The third row is an invitation whose seven days ran out —
 * `invitationPending` is documented as "unused **and** inside its window", so it
 * goes false on its own with nothing else changing. Folding it into *Invited*
 * would leave an owner waiting on a link that has already expired; folding it
 * into *Deactivated* would offer Reactivate, which the API refuses with a `409`
 * for somebody who never set a password. It needs its own word and it takes the
 * same action as an outstanding invitation.
 *
 * `active && !accepted` is not reachable — a user is activated by accepting —
 * and is treated as Active rather than given a fifth state, because the fact
 * that matters about it is that they can sign in.
 */

export type StaffState = 'active' | 'invited' | 'lapsed' | 'deactivated'

export type StaffStanding = {
  state: StaffState
  /** The chip's word. */
  label: string
  /** One sentence under the row: what this state means. */
  note: string
  /** Which of the two row actions applies, if either. */
  action: 'resend' | 'reactivate' | 'none'
}

export function standingOf(person: Staff): StaffStanding {
  if (person.active) {
    return {
      state: 'active',
      label: 'Active',
      note: 'Can sign in and take appointments.',
      action: 'none',
    }
  }

  if (person.accepted) {
    return {
      state: 'deactivated',
      label: 'Deactivated',
      // Says the thing an owner is most likely to be wrong about. Deactivating
      // somebody does not cancel their appointments, and the alert that appears
      // at the time is the only other place this is stated.
      note: 'Cannot sign in. Any appointments they already had are still in the calendar.',
      action: 'reactivate',
    }
  }

  if (person.invitationPending) {
    return {
      state: 'invited',
      label: 'Invited — awaiting acceptance',
      note: 'They have a link valid for seven days and choose their own password.',
      action: 'resend',
    }
  }

  return {
    state: 'lapsed',
    label: 'Invitation lapsed',
    note: 'Their invitation ran out before they used it. Sending a fresh one is the only way in.',
    action: 'resend',
  }
}

/**
 * How many people could sign in as an owner right now.
 *
 * The number `409 LAST_OWNER` is about, computed here so the row can disable a
 * control *with a reason* rather than offer it and be refused. It is a copy of a
 * server rule and therefore a courtesy, never the correctness: this list can be
 * a minute old, two owners can be demoted in two tabs, and the `409` is what
 * actually holds the line.
 */
export function activeOwnerCount(team: readonly Staff[]): number {
  return team.filter((person) => person.active && person.role === 'OWNER').length
}

/**
 * `409 LAST_OWNER`, in words — the wave gate asks for this code to have its own
 * copy, and this is it.
 *
 * One sentence, used in **three** places, which is the point of it being a
 * constant: the disabled button's reason, the disabled role option's reason, and
 * the message when the server refuses anyway. Somebody who was stopped early and
 * somebody who got through the guard on a stale list — a second tab, two owners
 * demoted at once — read the identical explanation, because they hit the identical
 * rule.
 *
 * `describeError` has no default for this code, and the server's own prose is
 * good ("This is the only active owner. Promote someone else first."). What this
 * adds is the *why*, which is the half an owner is entitled to before being told
 * no.
 */
export const LAST_OWNER_COPY =
  'A business must always have one active owner, or nobody could manage it. Promote another colleague to owner first.'

/**
 * Why this person cannot be deactivated or demoted, or `undefined` when they can.
 *
 * Used as a disabled control's reason as well as its tooltip — a disabled button
 * with no explanation attached is the most annoying thing an interface can do,
 * and the explanation has to reach a screen reader too, not only a pointer.
 */
export function lastOwnerReason(person: Staff, team: readonly Staff[]): string | undefined {
  if (person.role !== 'OWNER' || !person.active) return undefined
  if (activeOwnerCount(team) > 1) return undefined

  return LAST_OWNER_COPY
}
