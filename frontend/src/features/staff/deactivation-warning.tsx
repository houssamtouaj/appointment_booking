import { CalendarClock, Undo2, X } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { clockOf, dayKeyOf, formatDayHeading } from '@/lib/time'
import type { DeactivationWarning as Warning, Staff } from '@/types'

/**
 * "You have just deactivated somebody with four appointments still ahead of
 * them" — as a panel that stays until it is dismissed.
 *
 * **Not a toast, and that is a decision the wave records.** Every other
 * confirmation in this app is a toast, correctly: they say that something the
 * person just did worked, and the screen behind them already shows it. This one
 * is different in kind. It is *new information*, produced by the server, about a
 * consequence the owner could not have known — the API computes the count and the
 * next instant precisely so a client can present them — and it is the sort of
 * thing somebody needs to read twice, follow a link out of, and possibly undo. A
 * message that removes itself after four seconds cannot be any of those.
 *
 * Three things are in it because each one answers a question the owner now has:
 *
 * - **How many, and when is the next one.** The numbers, from `warning`.
 * - **What happened to them.** Nothing: they stay in the calendar and are not
 *   cancelled. This is the single most likely thing for an owner to be wrong
 *   about, and there is nowhere else on the screen that says it.
 * - **A way out.** A link into that filtered week, so the appointments can be
 *   moved to somebody else, and an Undo that reactivates the person.
 *
 * `role="alert"` rather than `status`: this interrupts, and a screen reader
 * should hear it on arrival rather than when the user happens to reach it.
 */

type DeactivationWarningProps = {
  person: Staff
  warning: Warning
  /** The business's zone, so "Tuesday at 14:00" is the salon's Tuesday. */
  timeZone: string
  onUndo: () => void
  undoing: boolean
  onDismiss: () => void
}

export function DeactivationWarning({
  person,
  warning,
  timeZone,
  onUndo,
  undoing,
  onDismiss,
}: DeactivationWarningProps) {
  const day = dayKeyOf(warning.nextBookingAt, timeZone)
  const count = warning.upcomingBookings

  return (
    <div
      role="alert"
      className="border-warning/50 bg-warning-wash text-foreground mb-6 rounded-md border px-4 py-4"
    >
      <div className="flex items-start gap-3">
        <CalendarClock className="text-warning mt-0.5 size-5 shrink-0" aria-hidden="true" />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {/* The **full** name, not the first word of it. A great many people's
                family name comes first, and an interface that greets somebody by
                the wrong half of their name is worse than one that is formal. */}
            {person.fullName} has {count} upcoming {count === 1 ? 'appointment' : 'appointments'},
            the next on {formatDayHeading(day)} at {clockOf(warning.nextBookingAt, timeZone)}.
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            They stay in the calendar and are not cancelled. Nobody has been told. Move them to a
            colleague, or bring {person.fullName} back.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              {/* Straight to the week those appointments are in, filtered to this
                  person — the calendar reads both from the URL, which is why that
                  screen put them there. */}
              <Link to={`/calendar?date=${day}&staff=${person.id}`}>See their appointments</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={onUndo} disabled={undoing}>
              <Undo2 aria-hidden="true" />
              {undoing ? 'Reactivating…' : 'Undo — reactivate them'}
            </Button>
          </div>
        </div>

        <Button variant="ghost" size="icon-sm" onClick={onDismiss} aria-label="Dismiss">
          <X aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}
