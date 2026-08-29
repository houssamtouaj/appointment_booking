import { CalendarPlus } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { describeError, requestIdOf } from '@/api/error-copy'
import { isApiError } from '@/api/error'
import { Container } from '@/components/container'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { BusinessNotFound } from '@/features/booking/business-not-found'
import { NoServices } from '@/features/booking/no-services'
import { OpeningHoursTable } from '@/features/booking/opening-hours-table'
import { useBusiness } from '@/features/booking/public-queries'
import { ServiceCard } from '@/features/booking/service-card'
import { LandingSkeleton } from '@/features/booking/skeletons'
import { TimezoneNote } from '@/features/booking/timezone-note'
import { zoneCity } from '@/lib/time'
import type { PublicBusiness } from '@/types'

/**
 * `/b/:slug` — the first thing a stranger sees, and the frame the README's GIF
 * opens on.
 *
 * One query. `GET /api/public/businesses/{slug}` returns the business, its
 * opening hours **and** its active catalogue together, so the `.../services`
 * endpoint is deliberately not called here — it returns the same shape and
 * exists for consumers that want the catalogue alone.
 */
export function BusinessLandingPage() {
  const { slug = '' } = useParams()
  const { data, isPending, isError, error, refetch } = useBusiness(slug)

  if (isPending) {
    return (
      <Container>
        {/* The skeleton is aria-hidden, so this is what a screen reader hears. */}
        <p role="status" className="sr-only">
          Loading this business
        </p>
        <LandingSkeleton />
      </Container>
    )
  }

  if (isError) {
    // A 404 is not a failure to retry — it is an answer, and it gets a screen.
    if (isApiError(error, 'NOT_FOUND')) return <BusinessNotFound slug={slug} />

    return (
      <Container width="copy">
        <div className="py-16">
          <ErrorState
            title="This page could not be loaded"
            description={describeError(error)}
            requestId={requestIdOf(error)}
            onRetry={() => void refetch()}
          />
        </div>
      </Container>
    )
  }

  return <Landing business={data} slug={slug} />
}

function Landing({ business, slug }: { business: PublicBusiness; slug: string }) {
  const bookHref = `/b/${slug}/book`

  return (
    <Container className="pb-20">
      <header className="pt-10 pb-8 sm:pt-14">
        <p className="text-muted-foreground text-2xs tracking-eyebrow font-mono uppercase">
          Book an appointment
        </p>
        {/* The condensed display face doing the job it was chosen for: a tenant's
            name is arbitrary and still has to hold at 375px. */}
        <h1 className="font-display text-display-lg text-foreground tracking-display mt-2 leading-tight">
          {business.name}
        </h1>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground text-base">
            {zoneCity(business.timezone)} · {business.services.length}{' '}
            {business.services.length === 1 ? 'service' : 'services'}
          </p>
          <Button asChild size="lg" className="sm:w-auto">
            <Link to={bookHref}>
              <CalendarPlus aria-hidden="true" />
              Book an appointment
            </Link>
          </Button>
        </div>

        <div className="mt-6 flex items-center" aria-hidden="true">
          <span className="bg-primary h-px w-10 shrink-0" />
          <span className="bg-rule h-px flex-1" />
        </div>
      </header>

      {/* Services first in the DOM, which is both the reading order that matters
          on a phone — the actionable thing above the reference thing — and the
          column order on a wide screen, where the catalogue takes the `1fr` and
          the timetable the fixed 18rem. Doing it with `order-last` instead put
          the sidebar in the wide column and squeezed six cards into 288px. */}
      <div className="grid gap-10 lg:grid-cols-[1fr_18rem] lg:gap-14">
        <section>
          <h2 className="text-muted-foreground text-2xs tracking-eyebrow font-mono uppercase">
            Services
          </h2>

          {business.services.length === 0 ? (
            <NoServices className="mt-4" />
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {business.services.map((service) => (
                <ServiceCard
                  key={service.id}
                  service={service}
                  currency={business.currency}
                  // Straight into step 2 with the choice already made. The
                  // landing page's cards are the service step.
                  to={`${bookHref}?service=${service.id}`}
                />
              ))}
            </div>
          )}
        </section>

        <aside>
          <h2 className="text-muted-foreground text-2xs tracking-eyebrow font-mono uppercase">
            Opening hours
          </h2>
          <div className="mt-4">
            <OpeningHoursTable hours={business.openingHours} timeZone={business.timezone} />
          </div>

          <div className="mt-4 space-y-3">
            <TimezoneNote timeZone={business.timezone} />
            <DepositNote business={business} />
          </div>
        </aside>
      </div>
    </Container>
  )
}

/**
 * The deposit sentence, and every word of it is deliberate (F5).
 *
 * `depositRequired` on this payload is the **raw business setting**:
 * `PublicBusinessService` maps `business.requiresDeposit()` directly, and only
 * `PublicBookingService` ANDs it with `payments.enabled()`. So the demo reports
 * `true` here and then confirms every booking with no deposit taken and no
 * checkout URL.
 *
 * Which means this page may say a deposit **may** be requested, and may not say
 * one **is** required — the second is a promise about money that the booking
 * response is the only thing entitled to make. Wave 4 reads
 * `status === 'PENDING' && checkoutUrl != null` and says something definite. Not
 * asserting it here is a wave gate item.
 */
function DepositNote({ business }: { business: PublicBusiness }) {
  if (!business.depositRequired) return null

  return (
    <p className="text-muted-foreground border-rule border-l-2 py-1 pl-3 text-sm">
      {business.depositPercent === undefined
        ? 'A deposit may be requested when you confirm.'
        : `A ${business.depositPercent}% deposit may be requested when you confirm.`}
    </p>
  )
}
