import { zodResolver } from '@hookform/resolvers/zod'
import { useCallback, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import { applyFieldErrors, isApiError } from '@/api/error'
import { describeError, requestIdOf } from '@/api/error-copy'
import { guestDetailsSchema } from '@/api/schemas/booking'
import { Container } from '@/components/container'
import { ErrorState } from '@/components/error-state'
import { BusinessNotFound } from '@/features/booking/business-not-found'
import { describeBookingFailure, type BookingFailure } from '@/features/booking/booking-errors'
import { BookingFailureAlert } from '@/features/booking/booking-failure-alert'
import {
  ANYONE,
  stepOf,
  toSearch,
  useBookingParams,
  type BookingParams,
  type BookingStep,
} from '@/features/booking/booking-params'
import { useCreateBooking } from '@/features/booking/booking-queries'
import { rememberedBookingToken } from '@/features/booking/booking-storage'
import { BookingStepper } from '@/features/booking/booking-stepper'
import { Confirmation } from '@/features/booking/confirmation'
import { DepositHandoff } from '@/features/booking/deposit-handoff'
import { DetailsStep } from '@/features/booking/details-step'
import { NoServices } from '@/features/booking/no-services'
import { useBusiness, useStaffForService } from '@/features/booking/public-queries'
import { ServiceCard } from '@/features/booking/service-card'
import { LandingSkeleton } from '@/features/booking/skeletons'
import { SlotStep } from '@/features/booking/slot-step'
import { StaffStep } from '@/features/booking/staff-step'
import { formatDuration } from '@/lib/time'
import { formatMoney } from '@/lib/money'
import type {
  GuestDetails,
  PublicBooking,
  PublicBusiness,
  PublicService,
  ValidationError,
} from '@/types'

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
  details: 'Who is this for?',
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

/** A failure, and the choices it was about — see `visibleFailure` below. */
type FlowFailure = {
  failure: BookingFailure
  /** `params.slot` at the moment of the attempt. `undefined` is impossible here. */
  slot: string
  /** `params.serviceId` at the moment of the attempt. `undefined` is impossible here. */
  serviceId: string
  unmatched: ValidationError[]
}

function Flow({ slug, business }: { slug: string; business: PublicBusiness }) {
  const { params, setParams } = useBookingParams()
  const navigate = useNavigate()
  const location = useLocation()

  /**
   * The service the URL names, **if the catalogue still has it**.
   *
   * A link can outlive a service: `?service=` may name one that has since been
   * archived, or simply be nonsense. Falling back to the service step renders a
   * question the customer can answer, where the alternative is a staff step
   * headed by a service name we do not have.
   *
   * This is not a staleness check standing in for the server's. Whether a
   * service is still *bookable* is answered by `422 SERVICE_INACTIVE` at booking
   * time and by nothing here; this is only about not rendering a step whose
   * subject is missing.
   */
  const service = business.services.find((candidate) => candidate.id === params.serviceId)

  const { data: staffList } = useStaffForService(slug, service?.id)
  const onlyStaff = staffList?.length === 1 ? staffList[0] : undefined

  /**
   * The same rule applied to `?staff=`, for the same reason.
   *
   * A link can outlive a staff member's assignment as easily as a service —
   * they leave, or stop performing this one — and an id nobody recognises goes
   * straight into the availability request as `staffId`, where the customer gets
   * an error screen or a permanently empty picker and no way to understand
   * either. Dropping back to step 2 asks a question they can answer.
   *
   * Only once the list has arrived: `staffList` is `undefined` while it loads,
   * and bouncing on that would send every direct link through the staff step
   * for a moment on its way in.
   */
  const staffKnown =
    params.staff === ANYONE || !staffList || staffList.some((member) => member.id === params.staff)

  /**
   * The choices the URL is allowed to claim. Everything below reads these rather
   * than the raw parameters, so the stepper, the heading and the step being
   * rendered cannot disagree about which choices are still real.
   */
  const effective: BookingParams = !service
    ? {}
    : staffKnown
      ? params
      : { serviceId: params.serviceId }
  const effectiveStep: BookingStep = stepOf(effective)

  const staffSummary =
    effective.staff === ANYONE
      ? // When one person is the only candidate the step answered itself, so the
        // stepper names them rather than saying "Anyone" — which would read as a
        // choice the customer did not make.
        (onlyStaff?.displayName ?? 'Anyone')
      : staffList?.find((member) => member.id === effective.staff)?.displayName

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
  const [failure, setFailure] = useState<FlowFailure | null>(null)

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
          setFailure(null)
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
        onError: (caught) => handleFailure(caught, slot, service.id),
      },
    )
  }

  function handleFailure(caught: unknown, slot: string, serviceId: string) {
    // Field-level messages first, so that a 422 lands under the input it is
    // about rather than only in the banner. What matches nothing comes back and
    // is shown, because React Hook Form accepts `setError` on an unregistered
    // path without complaint and the message would otherwise vanish.
    const unmatched = applyFieldErrors(caught, form)
    const described = describeBookingFailure(caught, business.timezone)
    setFailure({ failure: described, slot, serviceId, unmatched })

    if (described.recover === 'slot') {
      // Back to the picker: clear the slot, and open the week the server named
      // when it named one. The availability cache was already invalidated by the
      // mutation, so what redraws is what is free now.
      setParams({ slot: undefined, date: described.goToDate ?? params.date })
      return
    }
    if (described.recover === 'service') {
      // The catalogue changed underneath. Everything downstream of the service
      // is now meaningless, including the week.
      setParams({ serviceId: undefined, staff: undefined, date: undefined, slot: undefined })
    }
  }

  /**
   * Whether the failure still describes the situation on screen.
   *
   * It survives being sent back a step — that is the point of it — and stops the
   * moment the customer has chosen a *different* one of the things it blamed.
   * Comparing against the choices it happened on is what expresses that without
   * a second piece of state to keep in step.
   *
   * Both choices, not just the slot. `SERVICE_INACTIVE` and
   * `STAFF_NOT_ASSIGNED` recover by clearing the service *and* the slot, so a
   * slot-only rule can never see the recovery it asked for: the customer picks
   * another service, `slot` is still absent, and "that service is no longer
   * bookable" stays pinned above the staff step and the picker for a service it
   * was never about. Absent still counts as unchanged, which is what keeps the
   * sentence on screen for the step it sent them back to.
   */
  const visibleFailure =
    failure &&
    (!params.serviceId || params.serviceId === failure.serviceId) &&
    (!params.slot || params.slot === failure.slot)
      ? failure
      : undefined

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

  // The step that answered itself is not a step anyone can go back to: StaffStep
  // redirects out of it on mount, so a link there would do nothing visible.
  const answeredItself = Boolean(onlyStaff) && effective.staff === ANYONE

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
          message="You have already booked this slot in this tab."
        />
      ) : resumeToken ? (
        <ResumeNotice token={resumeToken} message="You already started a booking in this tab." />
      ) : null}

      <BookingStepper
        slug={slug}
        params={effective}
        summary={{
          service: service
            ? `${service.name} · ${formatDuration(service.durationMinutes)}`
            : undefined,
          staff: staffSummary,
        }}
        note={{ staff: answeredItself ? 'the only one for this service' : undefined }}
        locked={answeredItself ? ['staff'] : undefined}
      />

      <h1 className="font-display text-display-sm text-foreground tracking-display mt-8 leading-tight">
        {STEP_TITLE[effectiveStep]}
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
              {service.name} · {formatDuration(service.durationMinutes)} ·{' '}
              {formatMoney(service.priceCents, business.currency)}
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
  return (
    <div className="border-border bg-muted text-foreground mb-6 flex flex-wrap items-center justify-between gap-3 rounded-sm border px-4 py-3 text-sm">
      <span>{message}</span>
      <Link to={`/booking/${token}`} className="text-primary underline underline-offset-4">
        Open it
      </Link>
    </div>
  )
}

/** `""` and `"   "` both mean "not given". */
function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}
