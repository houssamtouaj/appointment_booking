import axios from 'axios'
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form'

import {
  errorCodeForStatus,
  problemDetailSchema,
  REQUEST_ID_HEADER,
  type ErrorCode,
  type ProblemDetail,
  type ValidationError,
} from '@/api/schemas/problem'
import { translate, type TKey } from '@/i18n'

/**
 * One error type for the whole app (F13).
 *
 * Every screen in every later wave decides what to say by switching on `code`,
 * never by matching on `detail` — `detail` is prose, the backend reserves the
 * right to reword it, and a client keying off it breaks on a copy edit. That
 * contract only holds if there is a single place that turns an Axios rejection
 * into this shape, which is `toApiError` below.
 */
export class ApiError extends Error {
  /** The enum member, never a bare string. `errorCodeForStatus` fills it in when the body cannot. */
  readonly code: ErrorCode
  /** 0 for a request that never reached the server — see `isNetworkFailure`. */
  readonly status: number
  /** Human prose. Safe to show; never safe to branch on. */
  readonly detail: string
  /** Populated on a 422, empty otherwise. `applyFieldErrors` is what consumes it. */
  readonly errors: ValidationError[]
  /**
   * The one string a person can quote that finds their exact request in the
   * server log — when there is one. See `readRequestId`: cross-origin, there
   * usually is not, and that is the API's CORS policy rather than an omission
   * here.
   */
  readonly requestId?: string
  /** The parsed body, for the rare screen that needs a member the fields above drop. */
  readonly problem?: ProblemDetail

  constructor(init: {
    code: ErrorCode
    status: number
    detail: string
    errors?: ValidationError[]
    requestId?: string
    problem?: ProblemDetail
    cause?: unknown
  }) {
    super(init.detail, { cause: init.cause })
    // Set explicitly rather than through constructor parameter properties:
    // `erasableSyntaxOnly` is on, and parameter properties need emit.
    this.name = 'ApiError'
    this.code = init.code
    this.status = init.status
    this.detail = init.detail
    this.errors = init.errors ?? []
    this.requestId = init.requestId
    this.problem = init.problem
  }

  /** True when the request never got an answer: offline, DNS, a CORS preflight the API refused. */
  get isNetworkFailure(): boolean {
    return this.status === 0
  }
}

/**
 * `isApiError(e)` narrows; `isApiError(e, 'SLUG_TAKEN', 'EMAIL_TAKEN')` also
 * asks which one, which is the form nearly every call site wants:
 *
 * ```ts
 * if (isApiError(error, 'SLUG_TAKEN')) form.setError('slug', { message: '…' })
 * ```
 */
export function isApiError(error: unknown, ...codes: ErrorCode[]): error is ApiError {
  if (!(error instanceof ApiError)) return false
  return codes.length === 0 || codes.includes(error.code)
}

/**
 * One of the extra members `ApiException.with(...)` attached at the throw site.
 *
 * These are the actionable half of a refusal — `earliestStart` on a
 * `POLICY_LEAD_TIME`, `deadline` on a `CANCELLATION_CUTOFF`, `startsAt` on a
 * `BOOKING_SLOT_TAKEN` — and they reach here only because
 * `problemDetailSchema` is a loose object. They are deliberately **not** typed
 * members of it: there is no published schema for the error body at all
 * (springdoc emits none, see `schemas/registry.ts`), so a typed field would be a
 * claim this side invented, and a screen that trusted it would render
 * `undefined` the day a code stopped carrying one.
 *
 * `unknown` is therefore the honest return type, and {@link problemInstant} is
 * the narrowing every call site in this wave actually wants.
 */
export function problemMember(error: unknown, name: string): unknown {
  if (!isApiError(error) || !error.problem) return undefined
  return (error.problem as Record<string, unknown>)[name]
}

/**
 * An extension member that should be an ISO instant, or `undefined`.
 *
 * Validated rather than cast, because the consequence of a wrong guess is the
 * one this app has spent two waves avoiding: `new Date(undefined)` is an
 * `Invalid Date`, every formatter renders it "Invalid Date" or `NaN`, and the
 * screen that was trying to be helpful about a deadline becomes the least
 * trustworthy thing on the page.
 */
export function problemInstant(error: unknown, name: string): string | undefined {
  const value = problemMember(error, name)
  if (typeof value !== 'string') return undefined
  return Number.isNaN(Date.parse(value)) ? undefined : value
}

/**
 * An extension member that should be a string, or `undefined`.
 *
 * The plain-prose half of {@link problemInstant}'s argument: a
 * `TIMEZONE_SHIFT_UNCONFIRMED` carries `currentTimezone` and `requestedTimezone`,
 * and the dialog that names both of them must not be able to render the word
 * `undefined` at an owner about to move every future slot. Empty strings are
 * rejected along with absent ones — a zone with no name is not a zone.
 */
export function problemText(error: unknown, name: string): string | undefined {
  const value = problemMember(error, name)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * An extension member that should be a number, or `undefined`.
 *
 * `affectedBookings` is the one this exists for, and the distinction it has to
 * keep is between **zero and unknown**: the timezone 409 arrives even when no
 * bookings are involved, so "0 bookings are affected" is a true sentence worth
 * saying and "we could not tell you how many" is a different one. A falsy check
 * would collapse the two, which is why this narrows on the type rather than on
 * the value.
 */
export function problemCount(error: unknown, name: string): number | undefined {
  const value = problemMember(error, name)
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * The single conversion point. Anything already an `ApiError` passes through, so
 * this is safe to call twice on the same rejection.
 *
 * Three cases, and the third is the one that gets forgotten: a response with a
 * status but no `application/problem+json` body at all. A load balancer's 502
 * and a 401 from a security filter that ran before the dispatcher both look like
 * that, and a mapper that assumed a body would throw a `TypeError` on top of the
 * failure it was meant to describe.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error

  if (!axios.isAxiosError(error)) {
    const detail = error instanceof Error ? error.message : String(error)
    return new ApiError({ code: 'INTERNAL_ERROR', status: 0, detail, cause: error })
  }

  const response = error.response
  if (!response) {
    // No response object at all: offline, aborted, DNS, or a CORS preflight the
    // API declined. The browser deliberately tells JavaScript nothing more than
    // "it failed", so there is no more specific message to be had here.
    // This `detail` is the `Error.message` and nothing else. Every screen that
    // shows a status-0 goes through `describeError`, which answers
    // `errors.networkFailure` before it ever looks at `detail` — so translating
    // this would be two dictionary entries for a string only a stack trace
    // reads, which is the same category as the `console.error` in
    // `api/reference.ts`.
    return new ApiError({
      code: 'INTERNAL_ERROR',
      status: 0,
      detail: 'Could not reach the server. Check your connection and try again.',
      cause: error,
    })
  }

  const status = response.status
  // `safeParse`, not `parse`. This body describes a failure; a schema mismatch
  // here must not replace a 409 the screen can explain with a Zod error it
  // cannot.
  const parsed = problemDetailSchema.safeParse(response.data)
  const problem = parsed.success ? parsed.data : undefined

  return new ApiError({
    code: problem?.code ?? errorCodeForStatus(status),
    status,
    detail: problem?.detail?.trim() || problem?.title || error.message,
    errors: problem?.errors,
    requestId: readRequestId(response.headers) ?? problem?.requestId,
    problem,
    cause: error,
  })
}

/**
 * The header first, the body second — and often neither, which is worth knowing
 * before somebody spends an afternoon on it.
 *
 * The API sends `X-Request-Id` on every response, and `Problems.of` additionally
 * puts `requestId` in the body **on 5xx only**, deliberately: it keeps 4xx
 * bodies byte-for-byte assertable in the backend's tests. So the header is the
 * better source, and this reads it first.
 *
 * What stops it working in the default dev mode and in production: `CorsConfig`
 * sets `exposedHeaders` to `Location, Retry-After` — *not* `X-Request-Id`. A
 * cross-origin response's other headers are invisible to JavaScript by
 * specification, so in `direct` and `crosssite` mode, and on the deployed
 * Vercel + Render pair, this returns `undefined` and the body fallback is all
 * there is. Which means: **a request id on a 4xx, cross-origin, is not
 * available at all.** The header is readable in `proxy` mode, where the request
 * is same-origin.
 *
 * That is the API's policy and wave 2 does not change it — the frontend does not
 * get to edit a backend with a 90% branch-coverage gate on a drive-by. The one
 * line that would fix it is `CorsConfig`'s `setExposedHeaders`, and it is raised
 * in the wave notes rather than done here. Nothing breaks meanwhile: `ErrorState`
 * and `FormAlert` both omit the reference line when there is no id, and a 4xx is
 * the class of failure a screen can explain without one.
 */
function readRequestId(headers: unknown): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined
  const value = (headers as Record<string, unknown>)[REQUEST_ID_HEADER]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Walks a 422's `errors[]` onto the form, and **returns the ones that landed
 * nowhere** (F13).
 *
 * The return value is the point. A naive version calls `setError` for every
 * entry and finishes; React Hook Form quietly accepts a path no input is
 * registered at, so an error on a field the form does not have becomes a
 * submission that appears to fail for no reason. Handing those back lets the
 * form put them somewhere a person can see — `hooks/use-form-error-summary.ts`
 * is where every form in the app does exactly that, and is the only caller that
 * needs to know this returns anything.
 *
 * Matching is by path, so `guest.email` finds the nested input. It relies on
 * the form declaring `defaultValues` for everything it registers, which every
 * form in this app does: `getValues()` is the only public way to ask React Hook
 * Form what it knows about, and a field with no default is absent from it.
 */
export function applyFieldErrors<TFieldValues extends FieldValues>(
  error: unknown,
  form: UseFormReturn<TFieldValues>,
  options?: {
    /**
     * Server field name to form field name, for the handful of places the two
     * legitimately differ — a request that nests what the form flattens.
     */
    rename?: Record<string, string>
    /**
     * Form field to a dictionary key, for the fields this app can predict.
     *
     * The server's `errors[]` messages are Bean Validation's, in English, and a
     * client cannot translate arbitrary prose — but it *can* say what "this field
     * is wrong" means for a field it owns, which is every field on every form in
     * this app. Anything unpredicted keeps the server's sentence: a wrong-language
     * sentence still names the problem, where a blank does not.
     */
    messageFor?: Record<string, TKey>
  },
): ValidationError[] {
  if (!isApiError(error) || error.errors.length === 0) return []

  const values = form.getValues()
  const unmatched: ValidationError[] = []
  let focused = false

  for (const item of error.errors) {
    const path = options?.rename?.[item.field] ?? item.field
    if (!hasPath(values, path)) {
      unmatched.push(item)
      continue
    }
    const key = options?.messageFor?.[path]
    form.setError(
      path as Path<TFieldValues>,
      { type: 'server', message: key ? translate(key) : item.message },
      // Focus the first one only. Focusing each in turn ends on the last field
      // the server happened to mention, which is rarely the one to fix first
      // and scrolls the page away from the others.
      { shouldFocus: !focused },
    )
    focused = true
  }

  return unmatched
}

/** `guest.email` and `slots[0].start` both resolve; a path no input registered does not. */
function hasPath(values: unknown, path: string): boolean {
  const segments = path.replace(/\[(\w+)\]/g, '.$1').split('.')
  let current: unknown = values

  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return false
    if (!(segment in (current as Record<string, unknown>))) return false
    current = (current as Record<string, unknown>)[segment]
  }
  return true
}
