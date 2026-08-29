import type { ValidationError } from '@/types'

type FormAlertProps = {
  /** The message for the failure as a whole. Chosen by `code`, never by matching on `detail`. */
  message: string
  /**
   * What `applyFieldErrors` handed back — the `errors[]` entries whose `field`
   * matched no input on this form.
   */
  unmatched?: ValidationError[]
  /** `X-Request-Id`, so a person reporting this has something to quote. */
  requestId?: string
}

/**
 * The banner above a form that failed as a whole.
 *
 * `unmatched` is why this takes more than a string. A 422 can name a field the
 * form does not have — the backend validates the request body, and a form is
 * only ever a view of one — and React Hook Form accepts `setError` on an
 * unregistered path without complaint. Those messages would vanish, and the
 * person would be looking at a form with no errors on it that refuses to submit.
 * `applyFieldErrors` returns them and this is where they go.
 */
export function FormAlert({ message, unmatched, requestId }: FormAlertProps) {
  return (
    <div
      role="alert"
      className="border-destructive/40 bg-danger-wash text-foreground mb-6 rounded-sm border px-4 py-3 text-sm"
    >
      <p className="font-medium">{message}</p>
      {unmatched && unmatched.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-4">
          {unmatched.map((item) => (
            <li key={`${item.field}:${item.message}`}>
              <span className="font-mono text-xs">{item.field}</span> — {item.message}
            </li>
          ))}
        </ul>
      ) : null}
      {requestId ? (
        <p className="text-muted-foreground mt-2 text-xs">
          Reference{' '}
          <code className="text-foreground bg-muted rounded-xs px-1.5 py-0.5 font-mono select-all">
            {requestId}
          </code>
        </p>
      ) : null}
    </div>
  )
}
