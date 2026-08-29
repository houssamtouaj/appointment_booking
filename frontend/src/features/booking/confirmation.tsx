import { CalendarCheck, Mail } from 'lucide-react'
import { Link } from 'react-router-dom'

import { CopyText } from '@/components/copy-text'
import { Button } from '@/components/ui/button'
import { BookingSummary } from '@/features/booking/booking-summary'
import { manageUrlFor } from '@/features/booking/manage-url'
import type { PublicBooking, PublicBusiness, PublicService } from '@/types'

type ConfirmationProps = {
  booking: PublicBooking
  business: PublicBusiness
  service: PublicService
  staffName?: string
}

/**
 * The `201` landed, `CONFIRMED`, nothing to pay.
 *
 * What it owes the customer, in order: that it worked, what was booked, and the
 * one string they will need again.
 *
 * **The manage link is shown as text, not only as a button.** It is the entire
 * credential for this booking — there is no account (backend D1), the token is
 * never reissued, and nobody can be looked up by email — so it has to be
 * copyable, readable aloud and writable on paper. A "Manage booking" button
 * alone hides the only thing they cannot afford to lose behind a click that does
 * not survive closing the tab.
 *
 * It also says the link is in their email, because that is the copy that stops
 * somebody screenshotting this screen in a panic.
 */
export function Confirmation({ booking, business, service, staffName }: ConfirmationProps) {
  const manageUrl = manageUrlFor(booking.cancellationToken)

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-start gap-4">
        <span className="bg-primary-wash text-primary inline-flex size-10 shrink-0 items-center justify-center rounded-sm">
          <CalendarCheck className="size-5" aria-hidden="true" />
        </span>
        <div>
          {/* The whole page changes to this, so it takes the h1 the step
              question had. A confirmation announced only by a paragraph is a
              screen a keyboard user has to go looking for. */}
          <h1 className="font-display text-display-sm text-foreground tracking-display leading-tight">
            You are booked
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {business.name} has your appointment. Nothing else to do.
          </p>
        </div>
      </div>

      <BookingSummary
        serviceName={service.name}
        durationMinutes={service.durationMinutes}
        staffName={staffName}
        startsAt={booking.startsAt}
        timeZone={business.timezone}
        priceCents={booking.priceCents}
        // The booking's own currency, not the business's — they are the same
        // today and the response is the authority on what was actually charged.
        currency={booking.currency}
      />

      <section className="border-border bg-card rounded-md border p-5">
        <h2 className="text-foreground text-base font-medium">Your link to this booking</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Keep this. It is the only way back to this appointment — to check it or to cancel it — and
          it does not expire.
        </p>

        <CopyText className="mt-4" value={manageUrl} label="Your booking link" />

        <p className="text-muted-foreground mt-4 flex items-start gap-2 text-sm">
          <Mail className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            The same link is in the confirmation email we have just sent, along with a calendar file
            you can add to your own calendar.
          </span>
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <Button asChild>
            {/* `Link`, not `<a href>`: a plain anchor reloads the document and
                throws away the query cache to move between two routes of the
                same app. */}
            <Link to={`/booking/${booking.cancellationToken}`}>Manage this booking</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to={`/b/${business.slug}`}>Back to {business.name}</Link>
          </Button>
        </div>
      </section>
    </div>
  )
}
