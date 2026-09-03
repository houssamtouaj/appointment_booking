import { zodResolver } from '@hookform/resolvers/zod'
import { useCallback, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import { formatDurationText } from '@/i18n/duration'
import { isApiError } from '@/api/error'
import { describeError, requestIdOf } from '@/api/error-copy'
import { guestDetailsSchema } from '@/api/schemas/booking'
import { Container } from '@/components/container'
import { ErrorState } from '@/components/error-state'
import { BusinessNotFound } from '@/features/booking/business-not-found'
import { BookingFailureAlert } from '@/features/booking/booking-failure-alert'
import { ANYONE, toSearch, type BookingStep } from '@/features/booking/booking-params'
import { useCreateBooking } from '@/features/booking/booking-queries'
import { rememberedBookingToken } from '@/features/booking/booking-storage'
import { BookingStepper } from '@/features/booking/booking-stepper'
import { Confirmation } from '@/features/booking/confirmation'
import { DepositHandoff } from '@/features/booking/deposit-handoff'
import { DetailsStep } from '@/features/booking/details-step'
import { NoServices } from '@/features/booking/no-services'
import { useBusiness } from '@/features/booking/public-queries'
import { ServiceCard } from '@/features/booking/service-card'
import { LandingSkeleton } from '@/features/booking/skeletons'
import { SlotStep } from '@/features/booking/slot-step'
import { StaffStep } from '@/features/booking/staff-step'
import { useBookingFailure } from '@/features/booking/use-booking-failure'
import { useEffectiveBookingParams } from '@/features/booking/use-effective-params'
import { formatMoney } from '@/lib/money'
import type { GuestDetails, PublicBooking, PublicBusiness, PublicService } from '@/types'
import { useTranslation, type TKey } from '@/i18n'

/**
 * `/b/:slug/book` — service, then who, then when, then who you are.
 *
 * Every choice is a query parameter, so the back button walks the steps, a
 * pasted link reopens the same state, and a failed booking can return someone to
 * step 3 with everything else intact. See `booking-params.ts` for why that beat
 * a context — and note that the details form is declared *here* rather than in
 * `DetailsStep` for the same reason: this component survives the query-string
 * change that takes the customer back a step, and what they typed survives with
 * it.
 */
export function BookingFlowPage() {
  const { t } = useTranslation()
  const { slug = '' } = useParams()
  const { data, isPending, isError, error, refetch } = useBusiness(slug)

  if (isPending) {
    return (
      <Container width="copy">
        <p role="status" className="sr-only">
          {t('booking.flow.loading')}
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
            title={t('booking.flow.errorTitle')}
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

/** The h1 of each step, as a key: the question the step is asking. */
const STEP_TITLE: Record<BookingStep, TKey> = {
  service: 'booking.flow.stepService',
  staff: 'booking.flow.stepStaff',
  slot: 'booking.flow.stepSlot',
  details: 'booking.flow.stepDetails',
}

/**
 * A booking that came back, kept with the service it was for.
 *
 * The service travels with it rather than being looked up again from the
 * catalogue, because at the moment of the `201` it was certainly there — that is
 * what was submitted — and re-deriving it afterwards means handling a
 * `find(...)` that returns `undefined` on the one screen that must not fail.
 */
type Booked = {
  booking: PublicBooking
  service: PublicService
  staffName?: string
}

function Flow({ slug, business }: { slug: string; business: PublicBusiness }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()

  /**
   * The URL's choices, reconciled against a catalogue and a roster that may have
   * moved since the link was made — see `use-effective-params.ts`. Everything
   * below reads `effective` rather than the raw parameters.
   */
  const { params, setParams, service, effective, effectiveStep, staffSummary, answeredItself } =
    useEffectiveBookingParams(slug, business)

  // ------------------------------------------------------------------
  //  Step 4: the form, the write, and the six ways it does not work
  // ------------------------------------------------------------------

  /**
   * Declared at the flow level and never remounted, which is the whole
   * mechanism behind "a `409` preserves the entered contact details". There is
   * no draft to serialise and no effect to restore one: the component holding
   * the state simply outlives the step.
   *
   * `defaultValues` for all four, including the optional ones, because
   * `applyFieldErrors` matches a server field against `getValues()` — a field
   * with no default is absent from that object, and a 422 naming it would be
   * silently dropped.
   */
  const form = useForm<GuestDetails>({
    resolver: zodResolver(guestDetailsSchema),
    defaultValues: { guestName: '', guestEmail: '', guestPhone: '', notes: '' },
  })

  const create = useCreateBooking(slug)
  const [booked, setBooked] = useState<Booked | null>(null)
  const {
    visibleFailure,
    report: reportFailure,
    clear: clearFailure,
  } = useBookingFailure({
    timeZone: business.timezone,
    form,
    params,
    setParams,
  })

  /**
   * A booking this tab already started, if Stripe's redirect never came back.
   *
   * The token was written to `sessionStorage` immediately before the hand-off
   * (see `deposit-handoff.tsx`), and the browser's Back button from an abandoned
   * or failed Checkout lands here — on a form for a slot that is already held by
   * the customer looking at it. Without this line the obvious next action is to
   * fill it in again, which is how one person ends up with two appointments.
   *
   * Read once, in an initialiser: it changes only when this tab navigates away,
   * and this component does not survive that.
   */
  const [resumeToken] = useState(rememberedBookingToken)

  const chooseStaff = useCallback(
    (staff: string, options?: { replace?: boolean }) => setParams({ staff }, options),
    [setParams],
  )

  const chooseDate = useCallback((date: string) => setParams({ date }), [setParams])

  function submit(values: GuestDetails) {
    if (!service || !effective.slot) return
    const slot = effective.slot

    create.mutate(
      {
        serviceId: service.id,
        // "Anyone" omits the field entirely rather than sending an id lifted
        // from the slot's `staffIds`, which would take the server's ability to
        // balance the booking away from it.
        staffId: effective.staff === ANYONE ? undefined : effective.staff,
        // Verbatim. Not reformatted, not rebuilt from a wall clock.
        startsAt: slot,
        guestName: values.guestName,
        guestEmail: values.guestEmail,
        // A blank optional field is omitted rather than sent as "". The column
        // is nullable and the API omits nulls; storing an empty string makes
        // "gave no phone number" and "gave an empty one" two states where the
        // domain has one.
        guestPhone: blankToUndefined(values.guestPhone),
        notes: blankToUndefined(values.notes),
      },
      {
        onSuccess: (created) => {
          clearFailure()
          setBooked({ booking: created, service, staffName: staffSummary })
          /**
           * **A history entry of its own, so that Back leaves the confirmation
           * instead of surviving it.**
           *
           * Without this the `201` changes the whole screen and nothing else:
           * the current entry is still the details URL, so Back rewinds to the
           * picker while "You are booked" stays on screen, and the two disagree
           * until something else re-renders.
           *
           * The entry carries the same URL and a marker in history *state*
           * rather than a new query parameter. The parameters here get pasted
           * into messages (`booking-params.ts`), and `?booked=1` in one would be
           * a claim this app cannot honour on another device — the booking it
           * names lives in this component's state and nowhere in the URL.
           * Forward returns to it, which is the affordance a customer who went
           * back too far actually needs.
           */
          navigate(location.pathname + location.search, { state: { booked: true } })
        },
        onError: (caught) => reportFailure(caught, { slot, serviceId: service.id }),
      },
    )
  }

  // ------------------------------------------------------------------
  //  Rendering
  // ------------------------------------------------------------------

  // The confirmation belongs to the entry the `201` pushed. Popped off it — Back
  // from the confirmation — this is false again and the flow renders the step the
  // URL names, which is the entry the customer is now standing on.
  const onConfirmationEntry = (location.state as { booked?: boolean } | null)?.booked === true

  if (booked && onConfirmationEntry) {
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

        {/*
         * The branch is on the response and on nothing else (F5). `PENDING` is a
         * deposit in flight; anything else is a finished booking.
         * `depositRequired` from the landing payload does not appear here,
         * because it is the raw business setting and the server ANDs it with
         * `payments.enabled()` — which is off on the deployed demo, where every
         * one of these is `CONFIRMED`.
         *
         * On the status alone, and not on `status && checkoutUrl`: a missing
         * `checkoutUrl` must not fall through to "You are booked, nothing else
         * to do" on a booking nobody has paid for. `DepositHandoff` says the
         * true thing without one.
         */}
        {booked.booking.status === 'PENDING' ? (
          <DepositHandoff
            booking={booked.booking}
            checkoutUrl={booked.booking.checkoutUrl}
            business={business}
            service={booked.service}
            staffName={booked.staffName}
          />
        ) : (
          <Confirmation
            booking={booked.booking}
            business={business}
            service={booked.service}
            staffName={booked.staffName}
          />
        )}
      </Container>
    )
  }

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

      {/*
       * Two ways to arrive at this form holding a booking that already exists,
       * and the same answer to both. Either the customer pressed Back off the
       * confirmation this tab has just shown them, or they left for Stripe and
       * came back with the Back button (`deposit-handoff.tsx` writes the token
       * to `sessionStorage` immediately before that hand-off). Answering either
       * with an empty form is how one person ends up with two appointments — and
       * in the first case the link on offer here is the credential the
       * confirmation screen told them to keep.
       */}
      {booked ? (
        <ResumeNotice
          token={booked.booking.cancellationToken}
          message={t('booking.flow.alreadyBooked')}
        />
      ) : resumeToken ? (
        <ResumeNotice token={resumeToken} message={t('booking.flow.alreadyStarted')} />
      ) : null}

      <BookingStepper
        slug={slug}
        params={effective}
        summary={{
          service: service
            ? t('booking.flow.serviceAndDuration', {
                name: service.name,
                duration: formatDurationText(service.durationMinutes),
              })
            : undefined,
          staff: staffSummary,
        }}
        note={{ staff: answeredItself ? t('booking.flow.onlyOne') : undefined }}
        locked={answeredItself ? ['staff'] : undefined}
      />

      <h1 className="font-display text-display-sm text-foreground tracking-display mt-8 leading-tight">
        {t(STEP_TITLE[effectiveStep])}
      </h1>

      <div className="mt-6">
        {visibleFailure ? (
          <BookingFailureAlert
            failure={visibleFailure.failure}
            unmatched={visibleFailure.unmatched}
          />
        ) : null}

        {effectiveStep === 'service' && business.services.length === 0 ? (
          // The same answer the landing page gives for the same payload. A
          // direct link to /book must not put the question above nothing.
          <NoServices />
        ) : null}

        {effectiveStep === 'service' && business.services.length > 0 ? (
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

        {effectiveStep === 'slot' && service && effective.staff ? (
          <>
            <SlotStep
              slug={slug}
              business={business}
              serviceId={service.id}
              staff={effective.staff}
              date={effective.date}
              onDateChange={chooseDate}
              onContinue={(slot) => setParams({ slot: slot.start })}
            />
            <p className="text-muted-foreground mt-8 text-sm">
              {t('booking.flow.serviceLine', {
                name: service.name,
                duration: formatDurationText(service.durationMinutes),
                price: formatMoney(service.priceCents, business.currency),
              })}
            </p>
          </>
        ) : null}

        {effectiveStep === 'details' && service && effective.slot ? (
          <DetailsStep
            form={form}
            business={business}
            service={service}
            staffName={staffSummary}
            startsAt={effective.slot}
            submitting={create.isPending}
            onSubmit={submit}
            backHref={`/b/${slug}/book${toSearch({
              serviceId: effective.serviceId,
              staff: effective.staff,
              date: effective.date,
            })}`}
          />
        ) : null}
      </div>
    </Container>
  )
}

function ResumeNotice({ token, message }: { token: string; message: string }) {
  const { t } = useTranslation()

  return (
    <div className="border-border bg-muted text-foreground mb-6 flex flex-wrap items-center justify-between gap-3 rounded-sm border px-4 py-3 text-sm">
      <span>{message}</span>
      <Link to={`/booking/${token}`} className="text-primary underline underline-offset-4">
        {t('booking.flow.openIt')}
      </Link>
    </div>
  )
}

/** `""` and `"   "` both mean "not given". */
function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}
