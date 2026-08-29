import { AlertTriangle } from 'lucide-react'

import type { BookingFailure } from '@/features/booking/booking-errors'
import type { ValidationError } from '@/types'

type BookingFailureAlertProps = {
  failure: BookingFailure
  /**
   * What `applyFieldErrors` handed back — `errors[]` entries naming a field this
   * form does not have. `serviceId` and `startsAt` are validated on the request
   * and are not inputs anybody can see, so a 422 about one of them would
   * otherwise vanish and leave a form with no errors on it that refuses to
   * submit.
   */
  unmatched?: ValidationError[]
}

/**
 * What went wrong, above whichever step the customer was just sent to.
 *
 * Rendered by the flow rather than by a step, because half of these failures
 * *move* the customer: a `409` returns them to the picker and the sentence has
 * to travel with them. A toast would not — it would announce a slot was taken
 * over a screen that no longer shows any slot in particular, and then disappear.
 *
 * `role="alert"`, so it is announced on arrival. This is the one thing on the
 * page that changed, and a keyboard user who pressed "Confirm booking" is
 * looking at the button, not at the top of the document.
 */
export function BookingFailureAlert({ failure, unmatched }: BookingFailureAlertProps) {
  return (
    <div
      role="alert"
      className="border-destructive/40 bg-danger-wash text-foreground mb-6 flex items-start gap-3 rounded-sm border px-4 py-3"
    >
      <AlertTriangle className="text-danger mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 text-sm">
        <p className="font-medium">{failure.title}</p>
        <p className="text-muted-foreground mt-1">{failure.description}</p>

        {unmatched && unmatched.length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {unmatched.map((item) => (
              <li key={`${item.field}:${item.message}`}>
                <span className="font-mono text-xs">{item.field}</span> — {item.message}
              </li>
            ))}
          </ul>
        ) : null}

        {failure.requestId ? (
          <p className="text-muted-foreground mt-2 text-xs">
            Reference{' '}
            <code className="text-foreground bg-muted rounded-xs px-1.5 py-0.5 font-mono select-all">
              {failure.requestId}
            </code>
          </p>
        ) : null}
      </div>
    </div>
  )
}
