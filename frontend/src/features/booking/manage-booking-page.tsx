import { CalendarCheck, CalendarX, CircleSlash, Clock } from 'lucide-react'
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
import { CancelSection } from '@/features/booking/cancel-section'
import { CheckoutNote } from '@/features/booking/checkout-note'
import { useHoldExpired } from '@/features/booking/hold-clock'
import { HoldNotice } from '@/features/booking/hold-notice'
import { manageUrlFor } from '@/features/booking/manage-url'
import { PaymentSection } from '@/features/booking/payment-section'
import { formatMoney } from '@/lib/money'
import { clockOf, dayKeyOf, formatDayHeading, viewerTimeZone, zoneAbbreviation } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { BookingStatus, PublicBooking } from '@/types'
import { useTranslation, type TKey } from '@/i18n'

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
  const { t } = useTranslation()
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

  /**
   * **The absence of a booking is what makes this a failure screen, not the
   * presence of an error.**
   *
   * A poll that fails puts the query into `error` while it keeps the booking it
   * already had — that is TanStack Query's whole reason for having
   * `isRefetchError` as well as `isLoadingError`. Reading `isError` first would
   * mean one 5xx during the ninety seconds of polling replaces a booking that is
   * on screen and correct — its status, its times, its guest, its cancel button
   * and the link that is the customer's only credential — with "could not be
   * loaded". So the whole-page failures below are the ones with nothing to show,
   * and a failed refresh is a line inside the page instead.
   */
  if (query.data === undefined) {
    if (query.isError) {
      // A 404 here is a designed screen, not a failure to log: this URL is
      // typed, forwarded and truncated, and "we cannot find that booking" is the
      // honest answer to all three.
      if (isApiError(query.error, 'NOT_FOUND')) {
        return (
          <Container width="copy" className="py-16">
            <h1 className="sr-only">{t('booking.manage.heading')}</h1>
            <EmptyState
              icon={CircleSlash}
              title={t('booking.manage.notFoundTitle')}
              description={t('booking.manage.notFoundBody')}
              action={
                <Button variant="outline" asChild>
                  <Link to="/">{t('booking.manage.goHome')}</Link>
                </Button>
              }
            />
          </Container>
        )
      }

      return (
        <Container width="copy" className="py-16">
          <h1 className="sr-only">{t('booking.manage.heading')}</h1>
          <ErrorState
            title={t('booking.manage.errorTitle')}
            description={describeError(query.error)}
            requestId={requestIdOf(query.error)}
            onRetry={() => void query.refetch()}
          />
        </Container>
      )
    }

    return (
      <Container width="copy" className="py-12">
        {/*
         * The page's name, for a screen reader and for anything that walks the
         * document outline. It is `sr-only` in all three states because what a
         * *sighted* reader needs first is the state itself — "we could not find
         * that booking" — and rendering both would put a generic title above a
         * specific one saying the same thing twice.
         */}
        <h1 className="sr-only">{t('booking.manage.heading')}</h1>
        <p role="status" className="sr-only">
          {t('booking.manage.loading')}
        </p>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-9 w-72" />
        <Skeleton className="mt-8 h-48 w-full" />
      </Container>
    )
  }

  return (
    <ManageBooking
      booking={query.data}
      checkout={checkout}
      polling={polling}
      gaveUp={gaveUp}
      onCheckAgain={checkAgain}
      refetching={query.isFetching}
      // Set only when there is still a booking underneath it. Rendered as one
      // line, because the page below it is the last good answer rather than a
      // wrong one.
      stale={query.isError}
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
  { icon: LucideIcon; title: TKey; body: TKey; tone: 'good' | 'wait' | 'gone' }
> = {
  PENDING: {
    icon: Clock,
    title: 'booking.manage.status.pendingTitle',
    body: 'booking.manage.status.pendingBody',
    tone: 'wait',
  },
  CONFIRMED: {
    icon: CalendarCheck,
    title: 'booking.manage.status.confirmedTitle',
    body: 'booking.manage.status.confirmedBody',
    tone: 'good',
  },
  CANCELLED: {
    icon: CalendarX,
    title: 'booking.manage.status.cancelledTitle',
    body: 'booking.manage.status.cancelledBody',
    tone: 'gone',
  },
  COMPLETED: {
    icon: CalendarCheck,
    title: 'booking.manage.status.completedTitle',
    body: 'booking.manage.status.completedBody',
    tone: 'good',
  },
  NO_SHOW: {
    icon: CircleSlash,
    title: 'booking.manage.status.noShowTitle',
    body: 'booking.manage.status.noShowBody',
    tone: 'gone',
  },
}

/**
 * The sixth row, for a booking whose status has not caught up with its clock.
 *
 * `PENDING` past its `expiresAt` is a real state and not a brief one: the
 * sweeper cancels an unpaid hold at the thirty-minute mark (backend D3), so
 * between the deadline and that job the API still answers `PENDING` for a slot
 * that is gone. Rendering {@link STATUS}`.PENDING` there tells a customer their
 * slot is held directly above a notice saying it is not.
 */
const HOLD_EXPIRED: (typeof STATUS)[BookingStatus] = {
  icon: CircleSlash,
  title: 'booking.manage.status.expiredTitle',
  body: 'booking.manage.status.expiredBody',
  tone: 'gone',
}

function ManageBooking({
  booking,
  checkout,
  polling,
  gaveUp,
  onCheckAgain,
  refetching,
  stale,
}: {
  booking: PublicBooking
  checkout: string | null
  polling: boolean
  gaveUp: boolean
  onCheckAgain: () => void
  refetching: boolean
  stale: boolean
}) {
  const { t } = useTranslation()
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

  /**
   * Live, not read once at mount. This page is left open — it is where Stripe
   * returns to, and where somebody sits while they go and find their card — so
   * the deadline passes *while it is on screen* rather than before it loads.
   */
  const holdExpired = useHoldExpired(booking.status === 'PENDING' ? booking.expiresAt : undefined)
  const held = booking.status === 'PENDING' && !holdExpired

  const status = booking.status === 'PENDING' && holdExpired ? HOLD_EXPIRED : STATUS[booking.status]
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
          {t('booking.manage.heading')}
        </p>
      </div>

      {stale ? (
        <p
          role="status"
          className="bg-muted text-muted-foreground mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm px-3 py-2 text-sm"
        >
          {t('booking.manage.stale')}
          <button
            type="button"
            onClick={onCheckAgain}
            disabled={refetching}
            className="text-foreground underline underline-offset-4 disabled:no-underline"
          >
            {refetching ? t('booking.manage.checking') : t('booking.manage.retry')}
          </button>
        </p>
      ) : null}

      <CheckoutNote checkout={checkout} status={booking.status} holdExpired={holdExpired} />

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
            {t(status.title)}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{t(status.body)}</p>
        </div>
      </div>

      {/* Only while it is still a hold. Once it is not, the heading above says
          so, and the notice would be the same sentence twice. */}
      {held ? (
        <HoldNotice expiresAt={booking.expiresAt} timeZone={timeZone} className="mt-6" />
      ) : null}

      <dl className="border-border bg-card divide-rule mt-6 divide-y rounded-md border px-5 py-1">
        <Row label={t('booking.summary.when')}>
          {/* One sentence rather than a day, the word "at", and two clocks in
              their own spans: French does not order them that way. */}
          {t('booking.manage.whenRange', {
            date: formatDayHeading(dayKeyOf(booking.startsAt, timeZone)),
            from: clockOf(booking.startsAt, timeZone),
            to: clockOf(booking.endsAt, timeZone),
          })}
        </Row>
        <Row label={t('booking.summary.price')}>
          <span className="font-mono">{formatMoney(booking.priceCents, booking.currency)}</span>
        </Row>
        {booking.guest ? (
          <Row label={t('booking.manage.bookedBy')}>
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
        {t('booking.manage.viewerZone', { abbreviation: zoneAbbreviation(timeZone) })}
      </p>

      {/* Nothing to pay towards a slot that has gone back into the calendar.
          Paying here would be paying for an appointment the sweeper is about to
          cancel. */}
      {held ? (
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
        <h2 className="text-foreground text-base font-medium">{t('booking.manage.linkHeading')}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t('booking.manage.linkBody')}</p>
        <CopyText
          className="mt-4"
          value={manageUrlFor(booking.cancellationToken)}
          label={t('booking.confirmation.linkLabel')}
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
