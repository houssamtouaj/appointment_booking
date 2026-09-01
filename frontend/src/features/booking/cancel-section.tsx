import { Button } from '@/components/ui/button'
import { clockOf, dayKeyOf, formatDayHeading } from '@/lib/time'
import type { PublicBooking } from '@/types'

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
  if (booking.status !== 'PENDING' && booking.status !== 'CONFIRMED') return null

  return (
    <section className="border-border mt-8 rounded-md border p-5">
      <h2 className="text-foreground text-base font-medium">Cannot make it?</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        {booking.cancellable
          ? `You can cancel online until ${formatWhen(booking.cancellationDeadline, timeZone)}.`
          : `The deadline to cancel online was ${formatWhen(booking.cancellationDeadline, timeZone)}. Please contact the business — they can still cancel it for you.`}
      </p>
      <Button variant="outline" className="mt-4" disabled={!booking.cancellable} onClick={onOpen}>
        Cancel this booking
      </Button>
    </section>
  )
}

function formatWhen(instant: string, timeZone: string): string {
  return `${formatDayHeading(dayKeyOf(instant, timeZone))} at ${clockOf(instant, timeZone)}`
}
