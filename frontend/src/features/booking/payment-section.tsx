import { ExternalLink, Loader } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { PublicBooking } from '@/types'
import { useTranslation } from '@/i18n'

/**
 * A `PENDING` booking, and what a customer can do about it.
 *
 * Two different situations wear the same status. One customer has just paid and
 * the webhook is a second behind the redirect; the other abandoned Checkout and
 * still holds the slot. `checkoutUrl` is present for both — the API offers it on
 * exactly the `PENDING` bookings — so both are given the way on, and the polling
 * line is what distinguishes them without the page having to guess.
 */
export function PaymentSection({
  booking,
  polling,
  gaveUp,
  onCheckAgain,
  refetching,
}: {
  booking: PublicBooking
  polling: boolean
  gaveUp: boolean
  onCheckAgain: () => void
  refetching: boolean
}) {
  const { t } = useTranslation()
  return (
    <section className="border-border bg-card mt-8 rounded-md border p-5">
      <h2 className="text-foreground text-base font-medium">{t('booking.payment.heading')}</h2>

      {booking.depositRefundable ? null : (
        <p className="text-muted-foreground mt-1 text-sm">{t('booking.payment.notRefunded')}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {booking.checkoutUrl ? (
          <Button asChild>
            {/* A full navigation to Stripe's own domain, so a plain anchor is
                right here where `Link` is wrong: this is not a route of this
                app. */}
            <a href={booking.checkoutUrl}>
              {t('booking.payment.pay')}
              <ExternalLink className="size-4" aria-hidden="true" />
            </a>
          </Button>
        ) : null}

        {polling ? (
          <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader className="size-4 animate-spin" aria-hidden="true" />
            {t('booking.payment.polling')}
          </p>
        ) : null}

        {gaveUp ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-muted-foreground text-sm">{t('booking.payment.gaveUp')}</p>
            <Button variant="outline" size="sm" onClick={onCheckAgain} disabled={refetching}>
              {refetching ? t('booking.payment.checking') : t('booking.payment.checkAgain')}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  )
}

/**
 * The cancel button, or the reason there is not one.
 *
 * `cancellable` is answered server-side by the same `BookingPolicy` the `DELETE`
 * enforces, so this page does not reimplement the cutoff arithmetic and cannot
 * disagree with the endpoint about it. When it is false the button is **shown
 * and disabled with the reason beside it**, not hidden: a missing control is a
 * question ("can I cancel this?") left unanswered, and the deadline that has
 * passed is the answer.
 *
 * A booking that is already cancelled, completed or missed gets no section at
 * all. There is nothing to cancel and nothing to explain.
 */
