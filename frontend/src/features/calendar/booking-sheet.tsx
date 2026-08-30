import { Dialog } from 'radix-ui'
import { X } from 'lucide-react'

import { describeError, requestIdOf } from '@/api/error-copy'
import { STAFF_TRANSITIONS } from '@/api/schemas/booking-admin'
import { ErrorState } from '@/components/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useBookingDetail } from '@/features/calendar/calendar-queries'
import { SheetBody } from '@/features/calendar/sheet-body'
import { transitionBlockedReason, useStatusMutation } from '@/features/calendar/status-mutation'
import { styleOf } from '@/features/calendar/status-style'
import { serviceNameIn, type Lookups } from '@/hooks/use-lookups'
import { clockOf, dayKeyOf, formatDayHeading } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { BookingDetail } from '@/types'

/**
 * One booking, in full, in a panel beside the calendar.
 *
 * A `Dialog` from Radix rather than a hand-rolled panel, because everything this
 * screen owes a keyboard user here is already solved correctly there and solved
 * badly nearly everywhere it is rewritten: focus moves in on open, is trapped
 * while it is open, returns to the tile that opened it on close, Escape closes
 * it, and the rest of the page is `aria-hidden` while it is up. The wave gate
 * asks for all five.
 *
 * It is a *sheet* rather than a centred modal because of what it is for. A
 * person opens this to read a phone number and then closes it; keeping the
 * calendar visible beside it means they can see which appointment they are
 * looking at, and on a phone it takes the screen because there is no beside.
 */

type BookingSheetProps = {
  bookingId: string
  lookups: Lookups
  timeZone: string
  currency: string
  onClose: () => void
}

export function BookingSheet({
  bookingId,
  lookups,
  timeZone,
  currency,
  onClose,
}: BookingSheetProps) {
  const detail = useBookingDetail(bookingId)
  const transition = useStatusMutation()
  const booking = detail.data

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="bg-scrim fixed inset-0 z-40" />
        <Dialog.Content
          /**
           * Focus goes back to the appointment that opened this, by hand.
           *
           * Radix restores focus to whatever had it when the panel mounted, which
           * is the right default and is not enough here: this sheet is opened by
           * a URL parameter rather than by a `Dialog.Trigger`, so it also opens
           * from a dashboard deep link where nothing on this page ever had focus,
           * and opening it re-renders the grid underneath. Naming the opener
           * explicitly is what makes the gate item — "Escape returns focus to the
           * opener" — true on both paths.
           *
           * When there is no tile to go back to, the default is left alone: a
           * deep-linked sheet closing on a week that does not contain its booking
           * has nowhere better to send focus than where Radix would.
           */
          onCloseAutoFocus={(event) => {
            // Booking ids are UUIDs, so there is nothing in one to escape.
            const opener = document.querySelector<HTMLElement>(`[data-booking-id="${bookingId}"]`)
            if (!opener) return
            event.preventDefault()
            opener.focus()
          }}
          className={cn(
            'bg-card text-card-foreground border-border fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l sm:max-w-[26rem]',
            'shadow-e3',
          )}
        >
          <header className="border-rule flex items-start justify-between gap-3 border-b px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="font-display text-display-sm text-foreground truncate leading-tight">
                {booking ? booking.guest.name : 'Appointment'}
              </Dialog.Title>
              {/* Radix warns without a description, and the honest one is what
                  this booking *is* — service, day and time — rather than a
                  restatement of the heading. */}
              <Dialog.Description className="text-muted-foreground mt-1 text-sm">
                {booking
                  ? `${serviceNameIn(lookups, booking.serviceId)} · ${formatDayHeading(
                      dayKeyOf(booking.startsAt, timeZone),
                    )} at ${clockOf(booking.startsAt, timeZone)}`
                  : 'Loading this appointment’s details.'}
              </Dialog.Description>
            </div>

            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close">
                <X aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
            {detail.error ? (
              <ErrorState
                title="This appointment could not be loaded"
                description={describeError(detail.error)}
                requestId={requestIdOf(detail.error)}
                onRetry={() => void detail.refetch()}
              />
            ) : booking ? (
              <SheetBody
                booking={booking}
                lookups={lookups}
                timeZone={timeZone}
                currency={currency}
              />
            ) : (
              <SheetSkeleton />
            )}
          </div>

          {booking ? <SheetActions booking={booking} transition={transition} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * The three moves a person can make, and the reason any of them is refused.
 *
 * Split out so the sheet above reads as a layout and this reads as a decision.
 */
function SheetActions({
  booking,
  transition,
}: {
  booking: BookingDetail
  transition: ReturnType<typeof useStatusMutation>
}) {
  const blocked = STAFF_TRANSITIONS.map((target) => ({
    target,
    reason: transitionBlockedReason(target, booking),
  }))
  // One sentence, not three. Before an appointment starts both time guards are
  // active and say almost the same thing, and stacking them reads as an error
  // rather than as a note.
  const firstReason = blocked.find((entry) => entry.reason)?.reason

  return (
    <footer className="border-rule border-t px-5 py-4">
      <p className="text-muted-foreground mb-2 text-xs">{styleOf(booking.status).meaning}</p>

      <div className="flex flex-wrap gap-2">
        {blocked.map(({ target, reason }) => (
          <Button
            key={target}
            size="sm"
            variant={target === 'CANCELLED' ? 'danger' : 'outline'}
            // Disabled *and* explained. A control that refuses without saying
            // why is the one thing worse than one that fails after a round trip.
            disabled={Boolean(reason) || transition.isPending}
            title={reason}
            onClick={() => transition.mutate({ id: booking.id, status: target })}
          >
            {styleOf(target).label}
          </Button>
        ))}
      </div>

      {/* The reason in text as well as in the tooltip: a `title` is unreachable
          by touch and unreliable to a screen reader, and this is the sentence
          that stops somebody pressing the button again. */}
      {firstReason ? <p className="text-muted-foreground mt-2 text-xs">{firstReason}</p> : null}
    </footer>
  )
}

function SheetSkeleton() {
  return (
    <div className="space-y-4">
      <span className="sr-only" role="status">
        Loading this appointment
      </span>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index}>
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-2 h-5 w-44" />
        </div>
      ))}
    </div>
  )
}
