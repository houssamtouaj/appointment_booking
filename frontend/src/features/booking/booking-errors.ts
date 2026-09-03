import { isApiError, problemInstant, problemMember } from '@/api/error'
import { describeError, requestIdOf } from '@/api/error-copy'
import { translate } from '@/i18n'
import { clockOf, dayKeyOf, formatDayHeading, type DayKey } from '@/lib/time'
import type { ErrorCode } from '@/types'

/**
 * The six ways a booking does not work, each one a designed screen.
 *
 * Keyed on `ApiError.code` and never on the status (F13). Two of these are
 * `409`s that mean opposite things and four are `422`s that lead to three
 * different places, so the status is not the question — and `detail` is prose
 * the backend may reword at any time.
 *
 * **Not a component.** `describeBookingFailure` is called from a mutation
 * handler, so it reads the language store through `translate` rather than
 * through `useTranslation` — the same reason `describeError` does. The caller
 * subscribes to the language; this only has to be right when it is called.
 *
 * **`409 BOOKING_SLOT_TAKEN` is the expected outcome, not a crash.** It is what
 * the whole double-booking guarantee produces when two people want the same
 * 10:00: one gets a booking, the other gets this, and the second person's
 * experience of the guarantee working is entirely this sentence. It reads as an
 * ordinary thing that happened rather than as a failure.
 */

/** Where the customer is sent, once they have read what happened. */
export type BookingRecovery =
  /** The failure is about what was typed. Stay on the details step. */
  | 'stay'
  /** Back to the picker — the slot is gone, stale, or outside the policy window. */
  | 'slot'
  /** Back to the start — the catalogue changed underneath. */
  | 'service'

export type BookingFailure = {
  code: ErrorCode
  /** One sentence, in the interface's voice. Errors here do not apologise. */
  title: string
  description: string
  recover: BookingRecovery
  /**
   * The day to open the picker on, for the two refusals that carry a boundary.
   * The server sends `earliestStart` / `latestStart`, so this is the business's
   * own window rather than a number this side guessed.
   */
  goToDate?: DayKey
  requestId?: string
}

/**
 * @param timeZone the **business's** zone. The boundary instants below become a
 *   day and a clock, and reading them in the viewer's zone would name a day the
 *   picker does not have — the same rule every other time on this screen follows.
 */
export function describeBookingFailure(error: unknown, timeZone: string): BookingFailure {
  const requestId = requestIdOf(error)
  const code: ErrorCode = isApiError(error) ? error.code : 'INTERNAL_ERROR'

  switch (code) {
    case 'BOOKING_SLOT_TAKEN':
      return {
        code,
        title: translate('booking.failure.slotTakenTitle'),
        description: translate('booking.failure.slotTakenBody'),
        recover: 'slot',
        requestId,
      }

    case 'POLICY_LEAD_TIME': {
      const earliest = problemInstant(error, 'earliestStart')
      return {
        code,
        title: translate('booking.failure.leadTimeTitle'),
        description: earliest
          ? translate('booking.failure.leadTimeBody', { when: at(earliest, timeZone) })
          : translate('booking.failure.leadTimeVague'),
        recover: 'slot',
        // The week on screen was accurate; it is the *chosen start* that is
        // inside the lead time. Refetching would return the same slots.
        goToDate: earliest ? dayKeyOf(earliest, timeZone) : undefined,
        requestId,
      }
    }

    case 'POLICY_MAX_ADVANCE': {
      const latest = problemInstant(error, 'latestStart')
      return {
        code,
        title: translate('booking.failure.maxAdvanceTitle'),
        description: latest
          ? translate('booking.failure.maxAdvanceBody', { when: at(latest, timeZone) })
          : translate('booking.failure.maxAdvanceVague'),
        recover: 'slot',
        goToDate: latest ? dayKeyOf(latest, timeZone) : undefined,
        requestId,
      }
    }

    // A customer never causes these by hand — every time on the picker came
    // from the engine. A tab left open over a lunch hour does.
    case 'SLOT_NOT_ON_GRID':
    case 'SLOT_OUTSIDE_HOURS':
      return {
        code,
        title: translate('booking.failure.staleTitle'),
        description: translate('booking.failure.staleBody'),
        recover: 'slot',
        requestId,
      }

    case 'SERVICE_INACTIVE':
      return {
        code,
        title: translate('booking.failure.serviceInactiveTitle'),
        description: translate('booking.failure.serviceInactiveBody'),
        recover: 'service',
        requestId,
      }

    case 'STAFF_NOT_ASSIGNED':
      return {
        code,
        title: translate('booking.failure.staffTitle'),
        description: translate('booking.failure.staffBody'),
        recover: 'service',
        requestId,
      }

    /**
     * Rate limited, and worth real copy because a customer meets it by accident
     * (F15). The endpoint is limited per IP *and* per email address (backend
     * D12), so mistyping an address twice and correcting it a third time spends
     * three of somebody's budget — and a household or an office behind one
     * address shares the first.
     */
    case 'RATE_LIMITED':
      return {
        code,
        title: translate('booking.failure.rateLimitedTitle'),
        description: translate('booking.failure.rateLimitedBody', { window: retryWindow(error) }),
        recover: 'stay',
        requestId,
      }

    default:
      return {
        code,
        title: translate('booking.failure.title'),
        description: describeError(error, {
          VALIDATION_FAILED: 'errors.bookingDetailsInvalid',
        }),
        // Everything unlisted keeps the customer where they are, with what they
        // typed. Sending them back a step for a failure nobody has classified
        // throws away work to no purpose.
        recover: 'stay',
        requestId,
      }
  }
}

/**
 * `"Thursday 3 September at 11:00"`, on the business's clock.
 *
 * The word "at" is a dictionary key rather than a literal in a template: French
 * joins a day and a clock differently, and a joined string cannot say so.
 */
function at(instant: string, timeZone: string): string {
  return translate('booking.summary.dateAtTime', {
    date: formatDayHeading(dayKeyOf(instant, timeZone)),
    time: clockOf(instant, timeZone),
  })
}

/**
 * How long to wait, from `retryAfterSeconds` when the server sent it.
 *
 * `RateLimitFilter`'s per-IP 429 and the per-email one raised inside
 * `PublicBookingService` both carry it, so this is usually a real number rather
 * than the vague fallback — and "wait 47 seconds" is a sentence somebody can act
 * on, where "try again later" is a sentence they retry immediately.
 */
function retryWindow(error: unknown): string {
  const seconds = problemMember(error, 'retryAfterSeconds')
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return translate('booking.failure.retryVague')
  }
  // Plural keys rather than a bare "s": French counts 0 with the singular, and a
  // one-second window is a real answer the old template got wrong in English too.
  if (seconds < 90) {
    return translate('booking.failure.retrySeconds', { count: Math.ceil(seconds) })
  }
  return translate('booking.failure.retryMinutes', { count: Math.ceil(seconds / 60) })
}
