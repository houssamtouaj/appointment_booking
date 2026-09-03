import { isApiError } from '@/api/error'
import type { ErrorCode } from '@/api/schemas/problem'
import { translate, type TKey } from '@/i18n'

/**
 * `ApiError.code` to a sentence a person can act on, in the reader's language.
 *
 * The backend's `detail` is prose and reads well, but it is written from the
 * server's point of view, it is explicitly allowed to change wording at any time
 * — `ErrorCode`'s javadoc says so — and it is always English. Screens therefore
 * switch on `code`, and the sentences live in `i18n/en.ts` and `i18n/fr.ts`
 * under `errors.<CODE>`, one entry per code, guarded by a test that walks
 * `errorCodeSchema` (F21).
 *
 * `translate` rather than `useTranslation`: this is a plain function called from
 * mutation handlers, toasts and error boundaries, and making it a hook would put
 * a hook in every one of those. It reads the module store, which is exactly why
 * the store is a module store.
 */

/**
 * @param overrides the screen's own wording for the codes it actually expects,
 *   as **dictionary keys** rather than sentences. A sign-in form says
 *   `errors.badCredentials` for `UNAUTHENTICATED`; a booking screen says
 *   something else entirely for the same code. Keys and not sentences because a
 *   sentence at a call site is a sentence in one language.
 */
export function describeError(
  error: unknown,
  overrides?: Partial<Record<ErrorCode, TKey>>,
): string {
  if (!isApiError(error)) return translate('errors.unknown')

  // A network failure carries the only sentence there is to say, and now it is
  // ours: `error.detail` for a status-0 is a string this app wrote, so it was
  // never the server's prose and had no business being returned untranslated.
  if (error.isNetworkFailure) return translate('errors.networkFailure')

  const override = overrides?.[error.code]
  if (override) return translate(override)

  const key = `errors.${error.code}` as TKey
  const copy = translate(key)
  // `translate` returns the key when it finds nothing, which is how the server's
  // detail stays reachable for a code this bundle predates (problem.ts's
  // `.catch()` degrades an unknown code, it does not reject the body).
  return copy === key ? (error.detail ?? translate('errors.unknown')) : copy
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
 * failure is worded, and "Reference" is part of that wording — in the reader's
 * language, from the same key `RequestIdNote` uses for the two-element form.
 *
 * `undefined` rather than an empty string when there is no id — a cross-origin
 * 4xx has none (see `readRequestId` in `error.ts`), and Sonner draws an empty
 * description as a blank line.
 */
export function referenceNote(error: unknown): string | undefined {
  const requestId = requestIdOf(error)
  return requestId ? translate('components.requestIdNote.referenceLine', { requestId }) : undefined
}
