import { CalendarClock } from 'lucide-react'
import { Link } from 'react-router-dom'

import { describeError, requestIdOf } from '@/api/error-copy'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { serviceNameIn, staffNameIn, type Lookups } from '@/hooks/use-lookups'
import { clockOf, dayKeyOf, formatDayShort, zoneCity } from '@/lib/time'
import type { BookingSummary } from '@/types'

type UpcomingListProps = {
  /** Absent while either the stats or the lookups are still in flight. */
  bookings?: readonly BookingSummary[]
  lookups: Lookups
  timeZone: string
  /** The tenant's public page, which is where an empty dashboard's next action goes. */
  slug: string
}

/**
 * The next five confirmed appointments — the list beside the tiles.
 *
 * Every row is a join: the API sends `serviceId` and `staffId` and no names,
 * which is the whole argument for `useLookups()` (F7). Because both lists are
 * fetched unfiltered, a booking naming a service that has since been archived or
 * a colleague who has since left still renders with both names on it, which is a
 * gate item and the reason the filter is left off.
 *
 * The left gutter is the time axis — day above, clock below, mono, in the
 * business's zone — which is the same column the calendar runs down its left
 * edge in wave 6. Rows are ruled apart rather than carded, because five
 * appointments in a row is a page of the book, not five objects.
 *
 * **No price on the row**, though `BookingSummaryResponse` carries one. Four
 * figures about money sit directly above this list, none of them is this one,
 * and a fifth amount here answers no question the list is for — it only competes
 * for the width the service and the colleague's name need, which at 375px is the
 * difference between "Amélie Rousseau" and "Amélie R…".
 */
export function UpcomingList({ bookings, lookups, timeZone, slug }: UpcomingListProps) {
  return (
    <section aria-labelledby="upcoming-heading">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="upcoming-heading" className="text-foreground text-sm font-medium">
          Next five appointments
        </h2>
        <span className="text-muted-foreground text-2xs tracking-eyebrow font-mono uppercase">
          {zoneCity(timeZone)}
        </span>
      </div>

      {bookings === undefined ? (
        <UpcomingSkeleton />
      ) : bookings.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No appointments scheduled"
          description="Nothing is booked from here on. The booking page is where the next one comes from."
          action={
            <Button asChild variant="outline" size="sm">
              <Link to={`/b/${slug}`}>Open the booking page</Link>
            </Button>
          }
        />
      ) : (
        <ol className="border-border bg-card overflow-hidden rounded-md border">
          {bookings.map((booking) => (
            <li key={booking.id} className="border-rule border-b last:border-b-0">
              <Row booking={booking} lookups={lookups} timeZone={timeZone} />
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * Each row links to the booking in the calendar, which wave 6 builds. Until then
 * it lands on `/calendar` with the booking's own day selected — the same
 * parameter the week grid will read — so the link is never dead and does not
 * have to be revisited when the detail sheet arrives.
 */
function Row({
  booking,
  lookups,
  timeZone,
}: {
  booking: BookingSummary
  lookups: Lookups
  timeZone: string
}) {
  const day = dayKeyOf(booking.startsAt, timeZone)

  return (
    <Link
      to={`/calendar?date=${day}`}
      className="hover:bg-accent flex items-center gap-4 px-4 py-3 transition-colors"
    >
      <span className="text-muted-foreground w-12 shrink-0 font-mono text-xs">
        <span className="block">{formatDayShort(day)}</span>
        <span className="text-foreground block text-sm">{clockOf(booking.startsAt, timeZone)}</span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate text-sm font-medium">
          {booking.guestName}
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          {serviceNameIn(lookups, booking.serviceId)} · {staffNameIn(lookups, booking.staffId)}
        </span>
      </span>
    </Link>
  )
}

/** Five rows at the height five rows actually are. */
function UpcomingSkeleton() {
  return (
    <div className="border-border bg-card overflow-hidden rounded-md border">
      <span className="sr-only" role="status">
        Loading the next appointments
      </span>
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className="border-rule flex items-center gap-4 border-b px-4 py-3 last:border-b-0"
        >
          <span className="w-12 shrink-0">
            <Skeleton className="h-4 w-10" />
            <Skeleton className="mt-1 h-5 w-11" />
          </span>
          <span className="min-w-0 flex-1">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-1 h-4 w-40" />
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * The list could not resolve its names. Separate from the tiles' failure on
 * purpose: `useLookups()` going down takes the names with it and leaves every
 * figure above perfectly correct, so blanking the whole screen would be a bigger
 * lie than the one it was avoiding.
 */
export function UpcomingError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <ErrorState
      title="The appointment list could not be loaded"
      description={describeError(error)}
      requestId={requestIdOf(error)}
      onRetry={onRetry}
    />
  )
}
