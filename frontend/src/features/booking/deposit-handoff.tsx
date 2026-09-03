import { CreditCard, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'

import { CopyText } from '@/components/copy-text'
import { Button } from '@/components/ui/button'
import { BookingSummary } from '@/features/booking/booking-summary'
import { rememberBookingToken } from '@/features/booking/booking-storage'
import { HoldNotice } from '@/features/booking/hold-notice'
import { manageUrlFor } from '@/features/booking/manage-url'
import type { PublicBooking, PublicBusiness, PublicService } from '@/types'
import { useTranslation } from '@/i18n'

type DepositHandoffProps = {
  /** A `PENDING` booking. */
  booking: PublicBooking
  /**
   * Stripe's hosted page, **and optional on purpose**.
   *
   * The API offers one on every `PENDING` booking it returns today — a failure
   * to open the session rolls the booking back rather than returning it — so
   * this is the branch that should not happen. It is here because the
   * alternative when it does is worse than a plain sentence: an unpaid hold
   * falling through to "You are booked, nothing else to do".
   */
  checkoutUrl?: string
  business: PublicBusiness
  service: PublicService
  staffName?: string
}

/**
 * The deposit path: the slot is held, and the next step is on Stripe's domain.
 *
 * **The navigation is a full one — `window.location.assign`, not a fetch.**
 * Checkout is a page on `checkout.stripe.com`; fetching it would be a CORS
 * failure at best, and rendering it inside this app is the pattern that trains
 * people to type card numbers into whatever frame is in front of them.
 *
 * **A screen before the redirect, rather than redirecting on arrival.** Two
 * things have to be said before the customer is somewhere this app no longer
 * controls: that the slot is held and until when (backend D3 cancels an unpaid
 * hold after thirty minutes), and that the deposit is not refunded (backend D7).
 * Neither survives being said on the page they are being sent away from, and
 * both are the kind of thing a person is owed before the money moves, not after.
 *
 * It is also the reason the button is a button. An automatic redirect gives
 * nobody time to read either sentence, and a browser that restores this page
 * from history would fire it again.
 */
export function DepositHandoff({
  booking,
  checkoutUrl,
  business,
  service,
  staffName,
}: DepositHandoffProps) {
  const { t } = useTranslation()
  function goToCheckout() {
    if (!checkoutUrl) return
    // Before the navigation, never after: this document stops existing on the
    // next line. It is the only way back if Stripe's return redirect fails, and
    // unlike an access token it is not a credential worth protecting from
    // script — it *is* the customer's own booking, and it is already in their
    // inbox. See `booking-storage.ts` for why sessionStorage and not local.
    rememberBookingToken(booking.cancellationToken)
    window.location.assign(checkoutUrl)
  }

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-start gap-4">
        <span className="bg-primary-wash text-primary inline-flex size-10 shrink-0 items-center justify-center rounded-sm">
          <CreditCard className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h1 className="font-display text-display-sm text-foreground tracking-display leading-tight">
            {t('booking.handoff.title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('booking.handoff.subtitle', { business: business.name })}
          </p>
        </div>
      </div>

      <HoldNotice expiresAt={booking.expiresAt} timeZone={business.timezone} />

      <BookingSummary
        serviceName={service.name}
        durationMinutes={service.durationMinutes}
        staffName={staffName}
        startsAt={booking.startsAt}
        timeZone={business.timezone}
        priceCents={booking.priceCents}
        currency={booking.currency}
      />

      {/* D7, in words, before the click rather than after it. */}
      {booking.depositRefundable ? null : (
        <p className="border-border text-foreground rounded-sm border px-3 py-2 text-sm">
          {/* The emphasis on "not refunded" goes with the fragments: French
              does not put the negation in one span the way English does. */}
          {t('booking.handoff.notRefunded')}
        </p>
      )}

      {checkoutUrl ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={goToCheckout}>
            {t('booking.handoff.checkout')}
            <ExternalLink className="size-4" aria-hidden="true" />
          </Button>
          <p className="text-muted-foreground text-xs">{t('booking.handoff.checkoutNote')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="border-danger/40 text-foreground rounded-sm border px-3 py-2 text-sm">
            {t('booking.handoff.unavailable')}
          </p>
          <Button size="lg" asChild>
            <Link to={`/booking/${booking.cancellationToken}`}>
              {t('booking.handoff.openBooking')}
            </Link>
          </Button>
        </div>
      )}

      <section className="border-border bg-card rounded-md border p-5">
        <h2 className="text-foreground text-base font-medium">
          {t('booking.handoff.fallbackHeading')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">{t('booking.handoff.fallbackBody')}</p>
        <CopyText
          className="mt-4"
          value={manageUrlFor(booking.cancellationToken)}
          label={t('booking.confirmation.linkLabel')}
        />
      </section>
    </div>
  )
}
