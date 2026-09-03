import { useCallback, useState } from 'react'
import type { FieldValues, UseFormReturn } from 'react-hook-form'

import { applyFieldErrors } from '@/api/error'
import { describeError, requestIdOf } from '@/api/error-copy'
import type { TKey } from '@/i18n'
import type { ErrorCode } from '@/api/schemas/problem'
import type { FormAlertProps } from '@/components/form-alert'
import type { ValidationError } from '@/types'

export type ReportFailureOptions = {
  /**
   * This form's own wording for the codes it actually expects, passed straight
   * to `describeError`. A sign-in form and a booking screen say different things
   * about the same code.
   */
  copy?: Partial<Record<ErrorCode, TKey>>
  /**
   * Server field name to form field name, for the handful of places the two
   * legitimately differ — a request that nests what the form flattens.
   */
  rename?: Record<string, string>
  /**
   * Form field to a dictionary key, passed straight to `applyFieldErrors`.
   *
   * The 422's `errors[]` messages are Bean Validation's, in English. This is how
   * a form says what "wrong" means for a field it owns, in the reader's
   * language; anything unlisted keeps the server's sentence.
   */
  messageFor?: Record<string, TKey>
}

export type FormErrorSummary = {
  /** What to hand `FormAlert`, or `null` when the form has nothing to apologise for. */
  alert: FormAlertProps | null
  /**
   * A failed mutation, turned into whatever the person needs to see: field
   * messages on the inputs that have them, a banner for the rest. Returns the
   * `errors[]` entries that matched no input, for the rare caller that wants to
   * do something else with them as well.
   */
  reportFailure: (error: unknown, options?: ReportFailureOptions) => ValidationError[]
  /** Called before a retry, and on close, so a stale banner cannot outlive its cause. */
  clear: () => void
}

/**
 * The three lines every form in this app wrote out for itself.
 *
 * `api/error.ts` has described this hook since wave 2 — *"`useFormErrorSummary`
 * in the account screens does exactly that"* — and it did not exist: the state
 * shape and the `onError` body were copied into ten files across six features
 * instead, which is the version of this that goes out of step one file at a time.
 *
 * The order inside `reportFailure` is the part worth having in one place.
 * `applyFieldErrors` runs first so that a 422 lands under the input it is about
 * rather than only in a banner, and it *returns* what matched nothing, because
 * React Hook Form accepts `setError` on an unregistered path without complaint
 * — so an error about a field this form does not have would otherwise vanish and
 * leave a submission that fails for no visible reason.
 *
 * Not applied to `booking-flow-page.tsx`, which looks like an eleventh copy and
 * is not: its state carries the slot and the service the attempt was made
 * against, its message comes from `describeBookingFailure`, and it routes six
 * failures back to the step that can fix them. What it shares is
 * `applyFieldErrors`, which it already calls directly.
 */
export function useFormErrorSummary<TFieldValues extends FieldValues>(
  form: UseFormReturn<TFieldValues>,
): FormErrorSummary {
  const [alert, setAlert] = useState<FormAlertProps | null>(null)

  const reportFailure = useCallback(
    (error: unknown, options?: ReportFailureOptions) => {
      const unmatched = applyFieldErrors(error, form, {
        ...(options?.rename ? { rename: options.rename } : {}),
        ...(options?.messageFor ? { messageFor: options.messageFor } : {}),
      })
      setAlert({
        message: describeError(error, options?.copy),
        unmatched,
        requestId: requestIdOf(error),
      })
      return unmatched
    },
    [form],
  )

  const clear = useCallback(() => setAlert(null), [])

  return { alert, reportFailure, clear }
}
