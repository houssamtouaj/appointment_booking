import { isApiError, problemInstant, problemMember } from '@/api/error'
import { describeError, requestIdOf } from '@/api/error-copy'
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
        title: 'That time was taken while you were filling this in',
        description:
          'Someone else booked it a moment ago. Your details are kept — choose another time and we will try again.',
        recover: 'slot',
        requestId,
      }

    case 'POLICY_LEAD_TIME': {
      const earliest = problemInstant(error, 'earliestStart')
      return {
        code,
        title: 'That is sooner than this business takes bookings',
        description: earliest
          ? `The earliest they can take you is ${at(earliest, timeZone)}. The times below start there.`
          : 'They need more notice than that. Please choose a later time.',
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
        title: 'That is further ahead than this business takes bookings',
        description: latest
          ? `The latest they can take you is ${at(latest, timeZone)}. The times below end there.`
          : 'They do not take bookings that far in advance. Please choose an earlier time.',
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
        title: 'That time is no longer on offer',
        description:
          'The times on screen were out of date. Here is what this business has free now.',
        recover: 'slot',
        requestId,
      }

    case 'SERVICE_INACTIVE':
      return {
        code,
        title: 'That service is no longer bookable',
        description:
          'This business stopped offering it while you were booking. Everything else it does is below.',
        recover: 'service',
        requestId,
      }

    case 'STAFF_NOT_ASSIGNED':
      return {
        code,
        title: 'Nobody here performs that service at the moment',
        description:
          'The team changed while you were booking. Choose another service, or try again later.',
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
        title: 'Too many booking attempts from here',
        description: `Wait ${retryWindow(error)} and try again. Your details are kept.`,
        recover: 'stay',
        requestId,
      }

    default:
      return {
        code,
        title: 'This booking could not be completed',
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

/** `"Thursday 3 September at 11:00"`, on the business's clock. */
function at(instant: string, timeZone: string): string {
  return `${formatDayHeading(dayKeyOf(instant, timeZone))} at ${clockOf(instant, timeZone)}`
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
    return 'a few minutes'
  }
  if (seconds < 90) return `${Math.ceil(seconds)} seconds`
  return `${Math.ceil(seconds / 60)} minutes`
}
