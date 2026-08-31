import { useQueryClient } from '@tanstack/react-query'

import { WeekTooLargeError } from '@/api/bookings'
import { describeError, requestIdOf } from '@/api/error-copy'
import { referenceKeys } from '@/api/reference'
import { Container } from '@/components/container'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { useAuth } from '@/features/auth/use-auth'
import { BookingList } from '@/features/calendar/booking-list'
import { BookingSheet } from '@/features/calendar/booking-sheet'
import { useCalendarParams } from '@/features/calendar/calendar-params'
import {
  useBookingList,
  useGridMinutes,
  useNearestWeekSearch,
  useOpeningHours,
  useWeekBookings,
} from '@/features/calendar/calendar-queries'
import { CalendarToolbar } from '@/features/calendar/calendar-toolbar'
import { nearestBusyDay } from '@/features/calendar/columns'
import { DayGrid } from '@/features/calendar/day-grid'
import { EmptyDay, EmptyWeek } from '@/features/calendar/empty-week'
import { buildScale } from '@/features/calendar/grid-scale'
import { WeekGrid } from '@/features/calendar/week-grid'
import { useLookups } from '@/hooks/use-lookups'
import { useMediaQuery, WEEK_GRID_MIN_WIDTH } from '@/hooks/use-media-query'
import { dayKeyOf, daysOfWeek, todayIn, zoneCity } from '@/lib/time'
import type { MeResponse } from '@/types'

/**
 * Screen 6: the week a business actually works.
 *
 * The one screen in the project built from scratch rather than from shadcn
 * primitives, and the one §10 nominates as the portfolio cover image. Why it is
 * hand-built is argued at length in the wave plan and comes down to one fact:
 * FullCalendar's differentiator is drag-to-move and resize, `PATCH
 * /api/bookings/{id}/status` is the only write the API exposes, and there is no
 * reschedule endpoint for either gesture to call. Its main feature is
 * unreachable; what remains is 200KB, a theming layer that fights Tailwind, and
 * a silhouette a reviewer recognises on sight.
 *
 * **The list is not scoped to the person looking.** `GET /api/bookings` carries
 * no role scoping, deliberately — a receptionist books for the whole salon — so
 * this screen shows the business to an `OWNER` and to a `STAFF` session alike.
 * That is the opposite of the dashboard, whose figures the server narrows by
 * role, and the difference is worth knowing when the two screens disagree.
 */
export function CalendarPage() {
  const { user } = useAuth()

  // `RequireAuth` is above this route, so a null user is unreachable. A guard
  // rather than a `!`, which would be a claim about the route table made from a
  // file that cannot see it.
  if (!user) return null

  return <Calendar user={user} />
}

/** A quiet page size for the list: two dozen rows is a screenful, not a scroll. */
const LIST_PAGE_SIZE = 25

function Calendar({ user }: { user: MeResponse }) {
  const queryClient = useQueryClient()
  const timeZone = user.business.timezone

  const params = useCalendarParams(timeZone)
  const lookups = useLookups()
  const rowMinutes = useGridMinutes()
  const business = useOpeningHours(user.business.slug)

  // Below 768px the week grid becomes the day grid. Derived rather than written
  // to the URL: the view a person *chose* stays chosen, so rotating a phone or
  // opening the same link on a laptop gives them the week back.
  const wideEnough = useMediaQuery(WEEK_GRID_MIN_WIDTH)
  const view = params.view === 'week' && !wideEnough ? 'day' : params.view

  const filters = { staffId: params.staffId, status: params.status }
  // The list pages server-side and the grids do not, so only one of the two is
  // ever in flight. `enabled` is what keeps a week of 100 bookings from being
  // fetched behind a list that only wants 25 of them.
  const week = useWeekBookings(params.week, timeZone, filters, { enabled: view !== 'list' })
  const list = useBookingList(params.week, timeZone, filters, params.page, LIST_PAGE_SIZE, {
    enabled: view === 'list',
  })

  const nearest = useNearestWeekSearch(params.week, timeZone, filters, params.setDate)

  const today = todayIn(timeZone)
  const scale = buildScale(
    view === 'day' ? [params.date] : daysOfWeek(params.week),
    timeZone,
    rowMinutes,
  )

  const bookings = week.data
  // The names are as much a dependency of a legible grid as the rows are: a
  // tile that renders an id for a moment and then swaps it for a name is a
  // flash of the database at a person.
  //
  // Whichever of the two reads this view is actually on: the other one is
  // disabled, and a disabled query is permanently `pending`.
  const filling = (view === 'list' ? list.isPending : week.isPending) || lookups.isLoading
  /** The rows this view is drawing, whichever query they came from. */
  const rows = view === 'list' ? list.data?.content : bookings
  // The day view is a filter over the week, not a second fetch — so whether this
  // particular day is empty is already known here, without asking anything.
  const hasBookingsOnDate = (bookings ?? []).some(
    (b) => dayKeyOf(b.startsAt, timeZone) === params.date,
  )
  const failure = view === 'list' ? list.error : week.error
  const stillHasData = view === 'list' ? list.data !== undefined : bookings !== undefined
  /**
   * Nothing to show, in any of the three views.
   *
   * The list gets the empty state too, and it is the one that most needs it: an
   * `<ol>` with no `<li>`s in it renders as a bordered strip of nothing, which
   * is indistinguishable from a list that failed to load. Page 2 of a list is
   * excluded — an empty page past the end is "you have gone too far", which the
   * pager already says with a Previous button, not "nothing is booked".
   */
  const emptyResult =
    rows !== undefined && rows.length === 0 && !filling && (view !== 'list' || params.page === 0)

  return (
    <Container className="pb-12">
      <PageHeader
        eyebrow="Admin"
        title="Calendar"
        description={`Every appointment at ${user.business.name}, in ${zoneCity(timeZone)} time.`}
        actions={
          <CalendarToolbar
            params={params}
            view={view}
            lookups={lookups}
            weekUnavailable={!wideEnough}
          />
        }
      />

      {lookups.error ? (
        // Names come from the lookups, and a grid of unnamed tiles is a grid of
        // unidentifiable appointments. Unlike the dashboard — where the figures
        // stay correct without them — there is nothing useful left here.
        <ErrorState
          title="The calendar could not resolve its names"
          description={describeError(lookups.error)}
          requestId={requestIdOf(lookups.error)}
          onRetry={() => void queryClient.invalidateQueries({ queryKey: referenceKeys.all })}
        />
      ) : failure && !stillHasData ? (
        <ErrorState
          // A week too large is not a failure to load, it is a refusal to draw
          // something misleading — so it says what to do rather than offering a
          // retry that would refuse identically.
          title={
            failure instanceof WeekTooLargeError
              ? 'This week has more appointments than the calendar can show'
              : 'This week could not be loaded'
          }
          description={
            failure instanceof WeekTooLargeError ? failure.message : describeError(failure)
          }
          requestId={requestIdOf(failure)}
          onRetry={
            failure instanceof WeekTooLargeError
              ? undefined
              : () => void (view === 'list' ? list.refetch() : week.refetch())
          }
        />
      ) : emptyResult ? (
        <EmptyWeek
          filtered={Boolean(params.staffId || params.status)}
          onClearFilters={() => params.setFilters({})}
          onFindNearest={() => nearest.mutate()}
          searching={nearest.isPending}
          searchedAndFoundNothing={nearest.isSuccess && nearest.data === null}
          slug={user.business.slug}
        />
      ) : view === 'list' ? (
        <BookingList
          page={list.data}
          lookups={lookups}
          timeZone={timeZone}
          pageIndex={params.page}
          onPage={params.setPage}
          selectedId={params.bookingId}
          onOpen={params.openBooking}
        />
      ) : view === 'day' && !filling && !hasBookingsOnDate ? (
        <EmptyDay
          nearestDay={nearestBusyDay(params.date, bookings ?? [], timeZone)}
          onGoToDay={params.setDate}
        />
      ) : view === 'day' ? (
        <DayGrid
          date={params.date}
          today={today}
          bookings={filling ? [] : (bookings ?? [])}
          loading={filling}
          scale={scale}
          timeZone={timeZone}
          lookups={lookups}
          openingHours={business.data?.openingHours}
          selectedId={params.bookingId}
          onOpen={params.openBooking}
        />
      ) : (
        <WeekGrid
          week={params.week}
          today={today}
          bookings={filling ? [] : (bookings ?? [])}
          loading={filling}
          scale={scale}
          timeZone={timeZone}
          lookups={lookups}
          openingHours={business.data?.openingHours}
          selectedId={params.bookingId}
          onOpen={params.openBooking}
        />
      )}

      {params.bookingId ? (
        <BookingSheet
          // Keyed by id, so opening a second booking from a dashboard deep link
          // remounts rather than showing the previous one's details under the
          // new one's heading while the fetch is in flight.
          key={params.bookingId}
          bookingId={params.bookingId}
          lookups={lookups}
          timeZone={timeZone}
          currency={user.business.currency}
          onClose={params.closeBooking}
        />
      ) : null}
    </Container>
  )
}
