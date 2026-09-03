import { formatDurationText } from '@/i18n/duration'
import { formatMoney } from '@/lib/money'
import { clockOf, dayKeyOf, formatDayHeading } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'

type BookingSummaryProps = {
  serviceName: string
  durationMinutes: number
  /** "Anyone", a name, or absent when the booking does not name a person. */
  staffName?: string
  /** The slot's `start`, as the API sent it. */
  startsAt: string
  /** The **business's** zone. Every time here is on the salon's clock, not the reader's. */
  timeZone: string
  priceCents: number
  currency: string
  className?: string
}

/**
 * What is about to be booked, restated in full.
 *
 * It exists so that nobody submits a slot they misread. By the time a customer
 * reaches the details form they have made three choices on three screens, the
 * last of them by pressing one chip in a grid of ninety-eight, and the only
 * thing standing between a misread chip and a wasted appointment is this panel.
 *
 * A description list rather than a stack of paragraphs: each row is a label and
 * a value, which is what `dl` means, and a screen reader then reads "When —
 * Thursday 3 September at 09:35" instead of two disconnected strings.
 *
 * The duration is spelled out beside the time rather than left to arithmetic on
 * an end time. "30 min" is the number a person checks against the rest of their
 * afternoon; "09:35–10:05" makes them do the subtraction.
 */
export function BookingSummary({
  serviceName,
  durationMinutes,
  staffName,
  startsAt,
  timeZone,
  priceCents,
  currency,
  className,
}: BookingSummaryProps) {
  const { t } = useTranslation()
  return (
    <dl
      className={cn(
        'border-border bg-card divide-rule divide-y rounded-md border px-5 py-1',
        className,
      )}
    >
      <Row label={t('booking.summary.service')}>
        {serviceName}
        <span className="text-muted-foreground"> · {formatDurationText(durationMinutes)}</span>
      </Row>

      {staffName ? <Row label={t('booking.summary.with')}>{staffName}</Row> : null}

      <Row label={t('booking.summary.when')}>
        {/* The day in the business's zone, and the clock in it too. Reading
            either through the viewer's zone puts a 01:40 Paris slot under the
            previous day for somebody in London. */}
        {/* One key joining the two, not the word "at" in JSX between them:
            French does not put it there and a joined string cannot say so. The
            monospace on the clock goes with it — it was styling on half a
            sentence. */}
        {t('booking.summary.dateAtTime', {
          date: formatDayHeading(dayKeyOf(startsAt, timeZone)),
          time: clockOf(startsAt, timeZone),
        })}
      </Row>

      <Row label={t('booking.summary.price')}>
        <span className="font-mono">{formatMoney(priceCents, currency)}</span>
      </Row>
    </dl>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
      <dt className="text-muted-foreground text-2xs tracking-eyebrow font-mono uppercase">
        {label}
      </dt>
      <dd className="text-foreground text-right text-sm">{children}</dd>
    </div>
  )
}
