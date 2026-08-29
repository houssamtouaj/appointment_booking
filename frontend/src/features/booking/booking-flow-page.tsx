import { useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'

import { isApiError } from '@/api/error'
import { describeError, requestIdOf } from '@/api/error-copy'
import { Container } from '@/components/container'
import { ErrorState } from '@/components/error-state'
import { BusinessNotFound } from '@/features/booking/business-not-found'
import { ANYONE, useBookingParams, type BookingStep } from '@/features/booking/booking-params'
import { BookingStepper } from '@/features/booking/booking-stepper'
import { useBusiness, useStaffForService } from '@/features/booking/public-queries'
import { ServiceCard } from '@/features/booking/service-card'
import { LandingSkeleton } from '@/features/booking/skeletons'
import { SlotStep } from '@/features/booking/slot-step'
import { StaffStep } from '@/features/booking/staff-step'
import { formatDuration } from '@/lib/time'
import { formatMoney } from '@/lib/money'
import type { PublicBusiness } from '@/types'

/**
 * `/b/:slug/book` — service, then who, then when.
 *
 * Every choice is a query parameter, so the back button walks the steps, a
 * pasted link reopens the same state, and wave 4 can send someone back here
 * after a failed booking with everything else intact. See `booking-params.ts`
 * for why that beat a context.
 */
export function BookingFlowPage() {
  const { slug = '' } = useParams()
  const { data, isPending, isError, error, refetch } = useBusiness(slug)

  if (isPending) {
    return (
      <Container width="copy">
        <p role="status" className="sr-only">
          Loading this business
        </p>
        <LandingSkeleton />
      </Container>
    )
  }

  if (isError) {
    if (isApiError(error, 'NOT_FOUND')) return <BusinessNotFound slug={slug} />
    return (
      <Container width="copy">
        <div className="py-16">
          <ErrorState
            title="This booking page could not be loaded"
            description={describeError(error)}
            requestId={requestIdOf(error)}
            onRetry={() => void refetch()}
          />
        </div>
      </Container>
    )
  }

  return <Flow slug={slug} business={data} />
}

const STEP_TITLE: Record<BookingStep, string> = {
  service: 'What are you booking?',
  staff: 'Who would you like?',
  slot: 'When suits you?',
}

function Flow({ slug, business }: { slug: string; business: PublicBusiness }) {
  const { params, step, setParams } = useBookingParams()

  /**
   * The service the URL names, **if the catalogue still has it**.
   *
   * A link can outlive a service: `?service=` may name one that has since been
   * archived, or simply be nonsense. Falling back to the service step renders a
   * question the customer can answer, where the alternative is a staff step
   * headed by a service name we do not have.
   *
   * This is not the staleness check the wave plan rules out. That one is about
   * *preventing* `422 SERVICE_INACTIVE` at booking time, which stays the
   * server's answer to give in wave 4; this is only about not rendering a step
   * whose subject is missing.
   */
  const service = business.services.find((candidate) => candidate.id === params.serviceId)
  const effectiveStep: BookingStep = service ? step : 'service'

  const { data: staffList } = useStaffForService(slug, service?.id)
  const onlyStaff = staffList?.length === 1 ? staffList[0] : undefined

  const chooseStaff = useCallback(
    (staff: string, options?: { replace?: boolean }) => setParams({ staff }, options),
    [setParams],
  )

  const chooseDate = useCallback((date: string) => setParams({ date }), [setParams])

  const staffSummary =
    params.staff === ANYONE
      ? // When one person is the only candidate the step answered itself, so the
        // stepper names them rather than saying "Anyone" — which would read as a
        // choice the customer did not make.
        (onlyStaff?.displayName ?? 'Anyone')
      : staffList?.find((member) => member.id === params.staff)?.displayName

  return (
    <Container width="copy" className="pb-20">
      <div className="pt-8 pb-6">
        <Link
          to={`/b/${slug}`}
          className="text-muted-foreground text-2xs tracking-eyebrow hover:text-foreground font-mono uppercase"
        >
          {business.name}
        </Link>
      </div>

      <BookingStepper
        slug={slug}
        params={service ? params : {}}
        summary={{
          service: service
            ? `${service.name} · ${formatDuration(service.durationMinutes)}`
            : undefined,
          staff: staffSummary,
        }}
        note={{
          staff: onlyStaff && params.staff === ANYONE ? 'the only one for this service' : undefined,
        }}
      />

      <h1 className="font-display text-display-sm text-foreground tracking-display mt-8 leading-tight">
        {STEP_TITLE[effectiveStep]}
      </h1>

      <div className="mt-6">
        {effectiveStep === 'service' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {business.services.map((candidate) => (
              <ServiceCard
                key={candidate.id}
                service={candidate}
                currency={business.currency}
                // A search-only `to` replaces the whole query string, which is
                // exactly the wanted behaviour: choosing a different service
                // clears the staff member and the week picked for the previous
                // one. A staff member who performs one service need not perform
                // the next.
                to={`?service=${candidate.id}`}
              />
            ))}
          </div>
        ) : null}

        {effectiveStep === 'staff' && service ? (
          <StaffStep
            slug={slug}
            serviceId={service.id}
            onChoose={chooseStaff}
            servicesHref={`/b/${slug}/book`}
          />
        ) : null}

        {effectiveStep === 'slot' && service && params.staff ? (
          <>
            <SlotStep
              slug={slug}
              business={business}
              serviceId={service.id}
              staff={params.staff}
              date={params.date}
              onDateChange={chooseDate}
            />
            <p className="text-muted-foreground mt-8 text-sm">
              {service.name} · {formatDuration(service.durationMinutes)} ·{' '}
              {formatMoney(service.priceCents, business.currency)}
            </p>
          </>
        ) : null}
      </div>
    </Container>
  )
}
