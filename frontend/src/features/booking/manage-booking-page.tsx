import { CalendarCheck, CalendarX, CircleSlash, Clock, ExternalLink, Loader } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { isApiError } from '@/api/error'
import { describeError, requestIdOf } from '@/api/error-copy'
import { Container } from '@/components/container'
import { CopyText } from '@/components/copy-text'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useBookingByToken, useCancelBooking } from '@/features/booking/booking-queries'
import { forgetBookingToken } from '@/features/booking/booking-storage'
import { CancelDialog } from '@/features/booking/cancel-dialog'
import { HoldNotice } from '@/features/booking/hold-notice'
import { manageUrlFor } from '@/features/booking/manage-url'
import { formatMoney } from '@/lib/money'
import { clockOf, dayKeyOf, formatDayHeading, viewerTimeZone, zoneAbbreviation } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { BookingStatus, PublicBooking } from '@/types'

/**
 * `/booking/:cancellationToken` (F6, F12) — the customer's whole relationship
 * with their booking, and **also the page Stripe returns to**.
 *
 * Three things about it are non-obvious and all three are decisions rather than
 * details.
 *
 * **A redirect is not a payment.** `?checkout=success` and `?checkout=cancelled`
 * choose the tone of one sentence and nothing else. The page reads the booking
 * either way, because the redirect is something a browser did and the payment is
 * something a webhook confirmed — and anyone can type this URL with
 * `?checkout=success` on the end. Rendering "paid" from the query string is the
 * one mistake this screen must not make.
 *
 * **The path is named by the backend and is not ours to rename** (F12).
 * `FrontendLinks.manageBooking` builds it into every customer email, so a link
 * sitting in an inbox from three weeks ago still has to resolve here.
 *
 * **The route is not gated.** The token is 122 bits of randomness and it is the
 * entire credential (backend D1). A token that resolves to nothing is a `404`
 * exactly like one that never existed, which is deliberate on the server's side:
 * an endpoint that distinguished "wrong" from "cancelled" would be an oracle
 * over that space.
 */
export function ManageBookingPage() {
  const { cancellationToken = '' } = useParams()
  const [search] = useSearchParams()
  const checkout = search.get('checkout')

  const { query, polling, gaveUp, checkAgain } = useBookingByToken(cancellationToken)

  /**
   * The round trip is over the moment this page has the booking.
   *
   * The token was written to `sessionStorage` before the redirect to Stripe as
   * the way back if that redirect never landed. It landed.
   */
  const loaded = query.data !== undefined
  useEffect(() => {
    if (loaded) forgetBookingToken()
  }, [loaded])

  if (query.isPending) {
    return (
      <Container width="copy" className="py-12">
        {/*
         * The page's name, for a screen reader and for anything that walks the
         * document outline. It is `sr-only` in all three states below because
         * what a *sighted* reader needs first is the state itself — "we could
         * not find that booking" — and rendering both would put a generic title
         * above a specific one saying the same thing twice.
         */}
        <h1 className="sr-only">Your booking</h1>
        <p role="status" className="sr-only">
          Loading your booking
        </p>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-9 w-72" />
        <Skeleton className="mt-8 h-48 w-full" />
      </Container>
    )
  }

  if (query.isError) {
    // A 404 here is a designed screen, not a failure to log: this URL is typed,
    // forwarded and truncated, and "we cannot find that booking" is the honest
    // answer to all three.
    if (isApiError(query.error, 'NOT_FOUND')) {
      return (
        <Container width="copy" className="py-16">
          <h1 className="sr-only">Your booking</h1>
          <EmptyState
            icon={CircleSlash}
            title="We could not find that booking"
            description="The link may be incomplete, or it may belong to a booking that was removed. Check the link in your confirmation email — it is the full one."
            action={
              <Button variant="outline" asChild>
                <Link to="/">Go to the booking page</Link>
              </Button>
            }
          />
        </Container>
      )
    }

    return (
      <Container width="copy" className="py-16">
        <h1 className="sr-only">Your booking</h1>
        <ErrorState
          title="Your booking could not be loaded"
          description={describeError(query.error)}
          requestId={requestIdOf(query.error)}
          onRetry={() => void query.refetch()}
        />
      </Container>
    )
  }

  // Read after the two guards above, not before them: `UseQueryResult` narrows
  // on the object, so `query.data` is defined here and a variable captured
  // earlier would not be.
  return (
    <ManageBooking
      booking={query.data}
      checkout={checkout}
      polling={polling}
      gaveUp={gaveUp}
      onCheckAgain={checkAgain}
      refetching={query.isFetching}
    />
  )
}

// ---------------------------------------------------------------------------

/**
 * One row per status, so that a booking in any of the five renders as a designed
 * screen.
 *
 * `COMPLETED` and `NO_SHOW` are not hypothetical: the token resolves forever, so
 * this page is opened weeks after the appointment as often as before it — from a
 * reminder email, or from a search of an inbox. A page that fell through to a
 * blank on either would fail exactly when somebody was checking whether they had
 * turned up.
 */
const STATUS: Record<
  BookingStatus,
  { icon: LucideIcon; title: string; body: string; tone: 'good' | 'wait' | 'gone' }
> = {
  PENDING: {
    icon: Clock,
    title: 'Waiting for your deposit',
    body: 'Your slot is held until the deposit is paid. Nobody else can take it in the meantime.',
    tone: 'wait',
  },
  CONFIRMED: {
    icon: CalendarCheck,
    title: 'Your booking is confirmed',
    body: 'You are expected. Nothing else to do.',
    tone: 'good',
  },
  CANCELLED: {
    icon: CalendarX,
    title: 'This booking was cancelled',
    body: 'The time has gone back into the calendar. This link keeps working, so you can always check what it was.',
    tone: 'gone',
  },
  COMPLETED: {
    icon: CalendarCheck,
    title: 'This appointment is done',
    body: 'It was marked completed by the business.',
    tone: 'good',
  },
  NO_SHOW: {
    icon: CircleSlash,
    title: 'Recorded as a no-show',
    body: 'The business marked this appointment as missed. If that is wrong, contact them — they can correct it.',
    tone: 'gone',
  },
}

function ManageBooking({
  booking,
  checkout,
  polling,
  gaveUp,
  onCheckAgain,
  refetching,
}: {
  booking: PublicBooking
  checkout: string | null
  polling: boolean
  gaveUp: boolean
  onCheckAgain: () => void
  refetching: boolean
}) {
  /**
   * The **viewer's** zone, and this is the one screen in the app where that is
   * right rather than a bug.
   *
   * Everywhere else times are rendered in the business's zone (F8), because a
   * slot's day is a property of the salon. Here there is no choice:
   * `PublicBookingResponse` carries no `timezone` — it has the two instants, the
   * price, the currency and the token, and no business at all — so the business
   * zone is not knowable from this payload. Rendering the reader's own clock and
   * naming it is the honest degradation; silently guessing UTC would put a 01:40
   * Paris appointment on the wrong day for its own customer. Raised as an API
   * gap in the wave notes rather than papered over.
   */
  const timeZone = viewerTimeZone()
  const status = STATUS[booking.status]
  const Icon = status.icon

  const cancel = useCancelBooking(booking.cancellationToken)
  const [dialogOpen, setDialogOpen] = useState(false)

  function openDialog(open: boolean) {
    setDialogOpen(open)
    // A dialog reopened after a refusal must not open onto the refusal. The
    // cutoff answer belongs to the attempt that produced it.
    if (!open) cancel.reset()
  }

  return (
    <Container width="copy" className="pb-20">
      <div className="pt-8 pb-6">
        <p className="text-muted-foreground text-2xs tracking-eyebrow font-mono uppercase">
          Your booking
        </p>
      </div>

      <CheckoutNote checkout={checkout} status={booking.status} />

      <div className="flex items-start gap-4">
        <span
          className={cn(
            'inline-flex size-10 shrink-0 items-center justify-center rounded-sm',
            status.tone === 'good' && 'bg-primary-wash text-primary',
            status.tone === 'wait' && 'bg-warning-wash text-warning',
            status.tone === 'gone' && 'bg-muted text-muted-foreground',
          )}
        >
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h1 className="font-display text-display-sm text-foreground tracking-display leading-tight">
            {status.title}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{status.body}</p>
        </div>
      </div>

      {booking.status === 'PENDING' ? (
        <HoldNotice expiresAt={booking.expiresAt} timeZone={timeZone} className="mt-6" />
      ) : null}

      <dl className="border-border bg-card divide-rule mt-6 divide-y rounded-md border px-5 py-1">
        <Row label="When">
          {formatDayHeading(dayKeyOf(booking.startsAt, timeZone))}
          <span className="text-muted-foreground"> at </span>
          <span className="font-mono">{clockOf(booking.startsAt, timeZone)}</span>
          <span className="text-muted-foreground"> – </span>
          <span className="font-mono">{clockOf(booking.endsAt, timeZone)}</span>
        </Row>
        <Row label="Price">
          <span className="font-mono">{formatMoney(booking.priceCents, booking.currency)}</span>
        </Row>
        {booking.guest ? (
          <Row label="Booked by">
            {booking.guest.name}
            <span className="text-muted-foreground"> · {booking.guest.email}</span>
            {booking.guest.phone ? (
              <span className="text-muted-foreground"> · {booking.guest.phone}</span>
            ) : null}
          </Row>
        ) : null}
      </dl>

      {/* One line, once, naming the clock every time above is on — the same rule
          the booking flow's timezone banner follows, for the same reason. */}
      <p className="text-muted-foreground mt-2 text-xs">
        Times shown in your own time zone ({zoneAbbreviation(timeZone)}).
      </p>

      {booking.status === 'PENDING' ? (
        <PaymentSection
          booking={booking}
          polling={polling}
          gaveUp={gaveUp}
          onCheckAgain={onCheckAgain}
          refetching={refetching}
        />
      ) : null}

      <CancelSection booking={booking} timeZone={timeZone} onOpen={() => openDialog(true)} />

      <section className="border-border bg-card mt-8 rounded-md border p-5">
        <h2 className="text-foreground text-base font-medium">Your link to this booking</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          This is the page you are on. Keep it — it does not expire, and it is the only way back to
          this appointment.
        </p>
        <CopyText
          className="mt-4"
          value={manageUrlFor(booking.cancellationToken)}
          label="Your booking link"
        />
      </section>

      <CancelDialog
        booking={booking}
        timeZone={timeZone}
        open={dialogOpen}
        onOpenChange={openDialog}
        cancelling={cancel.isPending}
        error={cancel.error}
        onConfirm={() =>
          cancel.mutate(undefined, {
            // Closed only on success. A refusal has to stay on screen, because
            // the cutoff answer carries a deadline and what to do instead.
            onSuccess: () => setDialogOpen(false),
          })
        }
      />
    </Container>
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

/**
 * The sentence Stripe's redirect earns, and the limit of what it earns.
 *
 * `?checkout=success` on a booking that is still `PENDING` says "we are checking
 * with your bank", never "paid". `?checkout=success` on a `CANCELLED` or expired
 * one says nothing at all — the status heading above already tells the truth,
 * and a thank-you over it would be the worst version of this screen.
 */
function CheckoutNote({ checkout, status }: { checkout: string | null; status: BookingStatus }) {
  if (checkout !== 'success' && checkout !== 'cancelled') return null

  if (checkout === 'cancelled') {
    if (status !== 'PENDING') return null
    return (
      <p role="status" className="bg-muted text-foreground mb-6 rounded-sm px-3 py-2 text-sm">
        No problem — you did not pay, and your slot is still held. You can pick up where you left
        off below.
      </p>
    )
  }

  if (status === 'CONFIRMED') {
    return (
      <p role="status" className="bg-primary-wash text-primary mb-6 rounded-sm px-3 py-2 text-sm">
        Thank you — your deposit came through.
      </p>
    )
  }

  if (status === 'PENDING') {
    return (
      <p role="status" className="bg-warning-wash text-warning mb-6 rounded-sm px-3 py-2 text-sm">
        Thanks. We are waiting for your bank to confirm the payment — this page updates itself.
      </p>
    )
  }

  return null
}

/**
 * A `PENDING` booking, and what a customer can do about it.
 *
 * Two different situations wear the same status. One customer has just paid and
 * the webhook is a second behind the redirect; the other abandoned Checkout and
 * still holds the slot. `checkoutUrl` is present for both — the API offers it on
 * exactly the `PENDING` bookings — so both are given the way on, and the polling
 * line is what distinguishes them without the page having to guess.
 */
function PaymentSection({
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
  return (
    <section className="border-border bg-card mt-8 rounded-md border p-5">
      <h2 className="text-foreground text-base font-medium">The deposit</h2>

      {booking.depositRefundable ? null : (
        <p className="text-muted-foreground mt-1 text-sm">
          Deposits are not refunded if you cancel.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {booking.checkoutUrl ? (
          <Button asChild>
            {/* A full navigation to Stripe's own domain, so a plain anchor is
                right here where `Link` is wrong: this is not a route of this
                app. */}
            <a href={booking.checkoutUrl}>
              Pay the deposit
              <ExternalLink className="size-4" aria-hidden="true" />
            </a>
          </Button>
        ) : null}

        {polling ? (
          <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader className="size-4 animate-spin" aria-hidden="true" />
            Checking for your payment…
          </p>
        ) : null}

        {gaveUp ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-muted-foreground text-sm">
              Still not confirmed. If you have paid, it may take another moment.
            </p>
            <Button variant="outline" size="sm" onClick={onCheckAgain} disabled={refetching}>
              {refetching ? 'Checking…' : 'Check again'}
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
function CancelSection({
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
