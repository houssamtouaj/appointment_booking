import { Timer } from 'lucide-react'

import { useRemaining } from '@/features/booking/hold-clock'
import { clockOf, zoneAbbreviation } from '@/lib/time'
import { cn } from '@/lib/utils'
import { translate, useTranslation } from '@/i18n'

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
  const { t } = useTranslation()
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
        {/* Two whole sentences rather than one assembled around a clock and a
            countdown. The zone is named in both because this same deadline is
            quoted again on the manage page after the Stripe round trip, and that
            page has no business in its payload so it renders the viewer's own
            clock — two different numbers for one instant is a contradiction only
            while neither of them says which clock it is on. */}
        {expired
          ? t('booking.hold.expired')
          : remaining === undefined
            ? t('booking.hold.until', {
                time: clockOf(expiresAt, timeZone),
                zone: zoneAbbreviation(timeZone, new Date(expiresAt)),
              })
            : t('booking.hold.untilWithRemaining', {
                time: clockOf(expiresAt, timeZone),
                zone: zoneAbbreviation(timeZone, new Date(expiresAt)),
                remaining: describeRemaining(remaining),
              })}
      </span>
    </p>
  )
}

/**
 * `"27 minutes"`, `"45 seconds"`. Never a bare number of milliseconds.
 *
 * `translate` and a plural key rather than `${n} second${n === 1 ? '' : 's'}`:
 * French counts 0 with the singular and English with the plural, which is the
 * rule a hand-rolled ternary cannot express. `Intl.PluralRules` knows it.
 */
function describeRemaining(ms: number): string {
  const seconds = Math.ceil(ms / 1000)
  if (seconds < 90) return translate('booking.hold.seconds', { count: seconds })
  return translate('booking.hold.minutes', { count: Math.ceil(seconds / 60) })
}
