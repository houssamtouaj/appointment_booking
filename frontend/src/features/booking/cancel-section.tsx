import { Button } from '@/components/ui/button'
import { clockOf, dayKeyOf, formatDayHeading } from '@/lib/time'
import type { PublicBooking } from '@/types'
import { translate, useTranslation } from '@/i18n'

/**
 * The cancellation half of the manage page, and the deadline it turns on.
 *
 * Split out of `manage-booking-page.tsx`, which held six components. This one has
 * its own reason to change — the online-cancellation window is a policy setting —
 * and its own thing to get right: `cancellable` is the server's verdict and is
 * never recomputed here, so a deadline that has passed since the page loaded is
 * answered by the API rather than guessed at locally.
 */
export function CancelSection({
  booking,
  timeZone,
  onOpen,
}: {
  booking: PublicBooking
  timeZone: string
  onOpen: () => void
}) {
  const { t } = useTranslation()
  if (booking.status !== 'PENDING' && booking.status !== 'CONFIRMED') return null

  return (
    <section className="border-border mt-8 rounded-md border p-5">
      <h2 className="text-foreground text-base font-medium">
        {t('booking.cancel.sectionHeading')}
      </h2>
      <p className="text-muted-foreground mt-1 text-sm">
        {booking.cancellable
          ? t('booking.cancel.until', {
              when: formatWhen(booking.cancellationDeadline, timeZone),
            })
          : t('booking.cancel.tooLate', {
              when: formatWhen(booking.cancellationDeadline, timeZone),
            })}
      </p>
      <Button variant="outline" className="mt-4" disabled={!booking.cancellable} onClick={onOpen}>
        {t('booking.cancel.open')}
      </Button>
    </section>
  )
}

/** A day and a clock on the business's own clock, joined by the dictionary. */
function formatWhen(instant: string, timeZone: string): string {
  return translate('booking.summary.dateAtTime', {
    date: formatDayHeading(dayKeyOf(instant, timeZone)),
    time: clockOf(instant, timeZone),
  })
}
