import { Timer } from 'lucide-react'

import { useRemaining } from '@/features/booking/hold-clock'
import { clockOf, zoneAbbreviation } from '@/lib/time'
import { cn } from '@/lib/utils'

type HoldNoticeProps = {
  /**
   * `expiresAt` from the booking — **and it is genuinely absent most of the
   * time**. Nulls are omitted from these payloads, and a `CONFIRMED` booking has
   * nothing in flight to time out, so this is `undefined` on every booking the
   * deployed demo creates.
   *
   * Typed optional rather than asserted, because the failure otherwise is the
   * one this wave's watch-outs name by hand: `new Date(undefined)` is an
   * `Invalid Date`, the subtraction is `NaN`, and the confirmation screen tells
   * a customer their slot is held for `NaN` minutes.
   */
  expiresAt?: string
  /** The business's zone. The wall clock quoted here is the salon's, like every other. */
  timeZone: string
  className?: string
}

/**
 * "This slot is held until 14:32 — 27 minutes left."
 *
 * The backend cancels an unpaid `PENDING` booking thirty minutes after it is
 * created (backend D3), and a customer who wanders off mid-checkout deserves to
 * know why the slot vanished rather than discovering it. So the deadline is
 * stated as a wall clock *and* as a remaining duration: the clock is what
 * somebody checks against the time on their phone, the duration is what tells
 * them whether to go and find their card now.
 *
 * Renders nothing at all without an `expiresAt`, which is the common case.
 */
export function HoldNotice({ expiresAt, timeZone, className }: HoldNoticeProps) {
  const remaining = useRemaining(expiresAt)

  if (!expiresAt) return null

  const expired = remaining !== undefined && remaining <= 0

  return (
    <p
      role="status"
      className={cn(
        'flex items-start gap-2 rounded-sm px-3 py-2 text-sm',
        expired ? 'bg-danger-wash text-danger' : 'bg-warning-wash text-warning',
        className,
      )}
    >
      <Timer className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        {expired ? (
          <>This hold has expired. The slot has gone back into the calendar.</>
        ) : (
          <>
            This slot is held until{' '}
            <span className="font-mono">{clockOf(expiresAt, timeZone)}</span>{' '}
            {/* The zone is named because this same deadline is quoted again on
                the manage page after the Stripe round trip, and that page has
                no business in its payload so it renders the viewer's own clock.
                Two different numbers for one instant is only a contradiction
                while neither of them says which clock it is on. */}
            ({zoneAbbreviation(timeZone, new Date(expiresAt))})
            {remaining === undefined ? null : <> — {describeRemaining(remaining)} left</>}.
          </>
        )}
      </span>
    </p>
  )
}

/** `"27 minutes"`, `"45 seconds"`. Never a bare number of milliseconds. */
function describeRemaining(ms: number): string {
  const seconds = Math.ceil(ms / 1000)
  if (seconds < 90) return `${seconds} second${seconds === 1 ? '' : 's'}`
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}
