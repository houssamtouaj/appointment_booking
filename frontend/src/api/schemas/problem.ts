import { z } from 'zod'

/**
 * The error contract. Mirrors `com.slotflow.common.error.ErrorCode` and
 * `Problems`, which is the single place the backend builds an error body —
 * every failure this app can see comes through it, including the ones written
 * by the servlet filters before the dispatcher exists.
 */

/**
 * The whole vocabulary, in the backend's declaration order.
 *
 * A `z.enum` and not a TypeScript `enum`: `erasableSyntaxOnly` is on
 * (tsconfig.app.json), so a TS enum would not compile — and this is the better
 * shape anyway, because it is a value at runtime that both `contract:check` and
 * the unknown-code fallback below can read.
 */
export const errorCodeSchema = z.enum([
  // Request shape and framework failures
  'VALIDATION_FAILED',
  'MALFORMED_REQUEST',
  'MISSING_PARAMETER',
  'METHOD_NOT_ALLOWED',
  'UNSUPPORTED_MEDIA_TYPE',
  'NOT_ACCEPTABLE',
  // Generic outcomes
  'NOT_FOUND',
  'UNAUTHENTICATED',
  'ACCESS_DENIED',
  'DATA_CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  // Identity and tenancy
  'SLUG_TAKEN',
  'EMAIL_TAKEN',
  'REFRESH_REUSED',
  'INVITATION_CONSUMED',
  'LAST_OWNER',
  // Catalog and configuration
  'STAFF_NOT_IN_BUSINESS',
  'HOURS_OVERLAP',
  'TIMEZONE_SHIFT_UNCONFIRMED',
  // Booking
  'SERVICE_INACTIVE',
  'STAFF_NOT_ASSIGNED',
  'POLICY_LEAD_TIME',
  'POLICY_MAX_ADVANCE',
  'SLOT_NOT_ON_GRID',
  'SLOT_OUTSIDE_HOURS',
  'BOOKING_SLOT_TAKEN',
  'ILLEGAL_TRANSITION',
  'CANCELLATION_CUTOFF',
  // Payments
  'PAYMENT_UNAVAILABLE',
  'WEBHOOK_SIGNATURE_INVALID',
])

export type ErrorCode = z.infer<typeof errorCodeSchema>

/** One entry of `errors[]` — `com.slotflow.common.error.ValidationError`. */
export const validationErrorSchema = z.object({
  /** The request-body path: `durationMinutes`, `guest.email`. */
  field: z.string(),
  message: z.string(),
})

export type ValidationError = z.infer<typeof validationErrorSchema>

/**
 * RFC 7807 plus the three members `Problems` adds.
 *
 * Every member is optional, and that is the design rather than laziness: this
 * schema parses a body produced by something that has already failed, so a
 * strict parse that threw would replace a 409 the screen could explain with a
 * Zod error it cannot. `toApiError` fills the gaps from the HTTP response.
 *
 * `code` is `.catch()`-guarded for the same reason at a longer timescale: a
 * backend that adds a code this bundle predates must not become an unhandled
 * parse failure in an already-deployed SPA. It degrades to the status-derived
 * code, which is what a client that had never heard of the new one would have
 * done anyway.
 *
 * **`looseObject` and not `object`, which is the whole reason a screen can say
 * anything specific.** `ApiException.with(...)` attaches extra members at the
 * throw site and they are the actionable half of several refusals: a
 * `POLICY_LEAD_TIME` carries `earliestStart`, a `POLICY_MAX_ADVANCE` carries
 * `latestStart`, a `CANCELLATION_CUTOFF` carries `deadline`, a
 * `BOOKING_SLOT_TAKEN` echoes the slot it lost. Zod's default object *strips*
 * unknown keys, so a plain `z.object` here would parse every one of those
 * successfully and throw the useful part away — leaving the page to say "too
 * soon" and not "the earliest we can take you is Thursday". They are read
 * through {@link problemMember}, which is where the absence of a type for them
 * is handled.
 */
export const problemDetailSchema = z.looseObject({
  type: z.string().optional(),
  title: z.string().optional(),
  status: z.number().optional(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  /** `ErrorCode.name()`. The member every call site switches on. */
  code: errorCodeSchema.optional().catch(undefined),
  /** Populated on every 422, absent otherwise. */
  errors: z.array(validationErrorSchema).optional(),
  /**
   * In the body on 5xx only — `Problems.of` adds it there and nowhere else, so
   * that 4xx bodies stay byte-for-byte assertable in the backend's tests. The
   * `X-Request-Id` response header carries it on every response, which is where
   * `toApiError` looks first.
   */
  requestId: z.string().optional(),
})

export type ProblemDetail = z.infer<typeof problemDetailSchema>

/** `com.slotflow.common.web.RequestCorrelation.HEADER`, lower-cased as Axios exposes it. */
export const REQUEST_ID_HEADER = 'x-request-id'

/**
 * `ErrorCode.forStatus` — the code to report for a status produced before any
 * of our code ran, or for a response carrying no problem body at all: a proxy's
 * 502, or a CORS rejection that reaches us as a bare network error.
 */
export function errorCodeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'MALFORMED_REQUEST'
    case 401:
      return 'UNAUTHENTICATED'
    case 403:
      return 'ACCESS_DENIED'
    case 404:
      return 'NOT_FOUND'
    case 405:
      return 'METHOD_NOT_ALLOWED'
    case 406:
      return 'NOT_ACCEPTABLE'
    case 409:
      return 'DATA_CONFLICT'
    case 415:
      return 'UNSUPPORTED_MEDIA_TYPE'
    case 422:
      return 'VALIDATION_FAILED'
    case 429:
      return 'RATE_LIMITED'
    default:
      return status >= 400 && status < 500 ? 'MALFORMED_REQUEST' : 'INTERNAL_ERROR'
  }
}
