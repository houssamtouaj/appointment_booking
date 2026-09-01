import { isApiError } from '@/api/error'
import type { ErrorCode } from '@/api/schemas/problem'

/**
 * `ApiError.code` to a sentence a person can act on.
 *
 * The backend's `detail` is prose and reads well, but it is written from the
 * server's point of view and it is explicitly allowed to change wording at any
 * time — `ErrorCode`'s javadoc says so. Screens therefore switch on `code`, and
 * this table is where the switch lives so that "that slug is taken" is worded
 * once for the whole app.
 *
 * Not every code needs an entry. A code with no default here falls back to the
 * server's `detail`, which is a good sentence written by somebody who knew the
 * context — the failure mode this table prevents is a screen that shows a raw
 * enum name, not one that shows the server's prose.
 */
const DEFAULT_COPY: Partial<Record<ErrorCode, string>> = {
  UNAUTHENTICATED: 'Please sign in and try again.',
  ACCESS_DENIED: 'You do not have access to that.',
  NOT_FOUND: 'That is no longer there.',
  RATE_LIMITED: 'Too many attempts. Wait a minute and try again.',
  VALIDATION_FAILED: 'Some of the details need fixing.',
  INTERNAL_ERROR: 'Something went wrong on our side. Try again in a moment.',
  PAYMENT_UNAVAILABLE: 'Payments are temporarily unavailable. Try again shortly.',
}

/**
 * @param overrides the screen's own wording for the codes it actually expects.
 *   A sign-in form says "Email or password is incorrect" for `UNAUTHENTICATED`;
 *   a booking screen says something else entirely for the same code.
 */
export function describeError(
  error: unknown,
  overrides?: Partial<Record<ErrorCode, string>>,
): string {
  if (!isApiError(error)) {
    return 'Something went wrong. Try again in a moment.'
  }
  // Network failures already carry the only sentence there is to say — the
  // browser tells JavaScript nothing about why a request never left.
  if (error.isNetworkFailure) return error.detail

  return overrides?.[error.code] ?? DEFAULT_COPY[error.code] ?? error.detail
}

/** The request id, when there is one, for the alert or toast that shows the message. */
export function requestIdOf(error: unknown): string | undefined {
  return isApiError(error) ? error.requestId : undefined
}

/**
 * The line under a toast that turns a report into a log query.
 *
 * One sentence, written identically in four features and six places, each of
 * them calling `requestIdOf` twice in the same expression. It belongs here for
 * the same reason `describeError` does: this file is where the app decides how a
 * failure is worded, and "Reference" is part of that wording.
 *
 * `undefined` rather than an empty string when there is no id — a cross-origin
 * 4xx has none (see `readRequestId` in `error.ts`), and Sonner draws an empty
 * description as a blank line.
 */
export function referenceNote(error: unknown): string | undefined {
  const requestId = requestIdOf(error)
  return requestId ? `Reference ${requestId}` : undefined
}
