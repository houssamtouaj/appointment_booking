import { useQueryClient } from '@tanstack/react-query'
import { CalendarSearch, ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'

import { fetchAvailability, publicKeys } from '@/api/public'
import { describeError, requestIdOf } from '@/api/error-copy'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import {
  availabilityRequest,
  nextOpeningRange,
  useAvailability,
  usePrefetchWeek,
  weekRangeFor,
} from '@/features/booking/public-queries'
import { SlotGrid } from '@/features/booking/slot-grid'
import { SlotGridSkeleton } from '@/features/booking/skeletons'
import { TimezoneNote } from '@/features/booking/timezone-note'
import {
  addDays,
  clockOf,
  dayKeyOf,
  formatDayHeading,
  formatRange,
  groupSlotsByDay,
  todayIn,
  weekOf,
  type DayKey,
} from '@/lib/time'
import type { PublicBusiness, Slot } from '@/types'

type SlotStepProps = {
  slug: string
  business: PublicBusiness
  serviceId: string
  staff: string
  /** The day whose week is showing. Absent means "this week, where the business is". */
  date?: DayKey
  onDateChange: (date: DayKey) => void
}

/**
 * Step 3 — the slot picker.
 *
 * One week at a time: `from` is the displayed Monday, `to` its Sunday, and `tz`
 * is the **business's** zone (F8), which is also the zone every time on this
 * screen is rendered in. Sending the viewer's zone instead would ask the server
 * to frame days in one place while the client draws headings for another, and
 * the two would disagree by a day at the edges.
 */
export function SlotStep({ slug, business, serviceId, staff, date, onDateChange }: SlotStepProps) {
  const timeZone = business.timezone
  const today = todayIn(timeZone)
  const week = weekRangeFor(date ?? today)
  const thisWeek = weekOf(today)

  const request = availabilityRequest(week, serviceId, staff, timeZone)
  const { data, isPending, isError, error, refetch } = useAvailability(slug, request)
  const prefetchWeek = usePrefetchWeek(slug)

  /**
   * The chosen slot, **and the week it was chosen in**.
   *
   * This component stays mounted while the week changes, so a bare `Slot` here
   * outlives the grid it came from: the chips redraw for the new week, none is
   * highlighted, and the sticky bar goes on offering "Monday 31 August at 09:35"
   * with a live Continue button for a slot that is not on screen. Carrying the
   * week and comparing during render is what makes the two agree — and it keeps
   * the selection when the customer navigates back to the week it belongs to,
   * where clearing it outright would throw the answer away.
   */
  const [chosen, setChosen] = useState<{ week: DayKey; slot: Slot } | null>(null)
  const selected = chosen?.week === week.from ? chosen.slot : null

  function select(slot: Slot) {
    setChosen({ week: week.from, slot })
  }

  const nextWeekStart = addDays(week.from, 7)
  const previousWeekStart = addDays(week.from, -7)
  // Nothing before this week is bookable, so the control that would go there is
  // disabled rather than allowed to fetch a week of guaranteed emptiness.
  const canGoBack = previousWeekStart >= thisWeek.from

  /**
   * One week ahead, on intent only — see `usePrefetchWeek`. A plain function
   * because the React Compiler memoises it; a manual useCallback it cannot
   * prove it preserves makes it skip the whole component.
   */
  function warmNextWeek() {
    prefetchWeek(availabilityRequest(weekRangeFor(nextWeekStart), serviceId, staff, timeZone))
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-display-sm text-foreground tracking-display leading-tight">
          {formatRange(week)}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous week"
            disabled={!canGoBack}
            onClick={() => onDateChange(previousWeekStart)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next week"
            onMouseEnter={warmNextWeek}
            onFocus={warmNextWeek}
            onClick={() => onDateChange(nextWeekStart)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>

      <TimezoneNote timeZone={timeZone} at={new Date(`${week.from}T12:00:00Z`)} />

      {isPending ? (
        <>
          <p role="status" className="sr-only">
            Loading available times
          </p>
          <SlotGridSkeleton />
        </>
      ) : isError ? (
        <ErrorState
          title="These times could not be loaded"
          description={describeError(error)}
          requestId={requestIdOf(error)}
          onRetry={() => void refetch()}
        />
      ) : (
        <WeekBody
          slots={data}
          slug={slug}
          business={business}
          serviceId={serviceId}
          staff={staff}
          today={today}
          weekStart={week.from}
          selected={selected}
          onSelect={select}
          onDateChange={onDateChange}
        />
      )}

      <SelectionBar business={business} selected={selected} />
    </div>
  )
}

function WeekBody({
  slots,
  slug,
  business,
  serviceId,
  staff,
  today,
  weekStart,
  selected,
  onSelect,
  onDateChange,
}: {
  slots: Slot[]
  slug: string
  business: PublicBusiness
  serviceId: string
  staff: string
  today: DayKey
  /** The displayed Monday, which is what the empty state's own state is scoped to. */
  weekStart: DayKey
  selected: Slot | null
  onSelect: (slot: Slot) => void
  onDateChange: (date: DayKey) => void
}) {
  const days = groupSlotsByDay(slots, business.timezone)

  if (days.length > 0) {
    return (
      <SlotGrid
        days={days}
        timeZone={business.timezone}
        selectedStart={selected?.start}
        onSelect={onSelect}
      />
    )
  }

  return (
    /*
     * Keyed by the week, so its state does not outlive the week it describes.
     * `searchError` and `exhausted` are answers about *this* week's search, and
     * without the key one failed search paints "The search could not be
     * completed" over every empty week the customer navigates to afterwards —
     * weeks whose own request succeeded.
     */
    <EmptyWeek
      key={weekStart}
      slug={slug}
      business={business}
      serviceId={serviceId}
      staff={staff}
      today={today}
      onDateChange={onDateChange}
    />
  )
}

/**
 * An empty week, and the state the brief calls out by name (§7).
 *
 * "No slots" with no next action is the failure it names, and an empty week is
 * the *common* case on a quiet business — so this offers to do the search the
 * customer would otherwise do by clicking "next" eleven times.
 *
 * There is no next-available endpoint, so it is built here: one widened request
 * from today across 60 days (61 inclusive, inside the API's 62-day cap), then a
 * jump to the first day that has anything. Deliberately one call rather than a
 * week-at-a-time walk, which would be twelve round trips to answer one question.
 *
 * Policy numbers are not hard-coded into any of this copy. `minLeadTimeHours`
 * and `maxAdvanceDays` are on no public endpoint, so the client cannot know the
 * business's real booking window; it asks wide and lets the server trim.
 */
function EmptyWeek({
  slug,
  business,
  serviceId,
  staff,
  today,
  onDateChange,
}: {
  slug: string
  business: PublicBusiness
  serviceId: string
  staff: string
  today: DayKey
  onDateChange: (date: DayKey) => void
}) {
  const queryClient = useQueryClient()
  const [searching, setSearching] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [searchError, setSearchError] = useState<unknown>(null)

  const findNextOpening = useCallback(async () => {
    setSearching(true)
    setSearchError(null)
    try {
      const request = availabilityRequest(
        nextOpeningRange(today),
        serviceId,
        staff,
        business.timezone,
      )
      // `fetchQuery`, not `prefetchQuery`: this one is a direct answer to a
      // button press, so its failure has to reach the person who pressed it.
      const found = await queryClient.fetchQuery({
        queryKey: publicKeys.availability(slug, request),
        queryFn: ({ signal }) => fetchAvailability(slug, request, signal),
      })
      const [firstDay] = groupSlotsByDay(found, business.timezone)
      if (!firstDay) setExhausted(true)
      else onDateChange(firstDay.dayKey)
    } catch (caught) {
      setSearchError(caught)
    } finally {
      setSearching(false)
    }
  }, [business.timezone, onDateChange, queryClient, serviceId, slug, staff, today])

  if (searchError) {
    return (
      <ErrorState
        title="The search could not be completed"
        description={describeError(searchError)}
        requestId={requestIdOf(searchError)}
        onRetry={() => void findNextOpening()}
      />
    )
  }

  if (exhausted) {
    /*
     * The truthful message, and it is different from an error: the request
     * succeeded and the answer is that there is nothing.
     *
     * The wave plan asks for contact details here. **The public API exposes
     * none** — `PublicBusinessResponse` is slug, name, timezone, currency, the
     * two deposit fields, opening hours and services, and that is the whole
     * payload (verified by `contract:check` against the live document). Adding a
     * field to the backend is explicitly out of bounds for the frontend, so this
     * shows what the page does have — when the business is open — and says so
     * plainly rather than inventing a phone number. Raised in the wave notes.
     */
    return (
      <EmptyState
        icon={CalendarSearch}
        title="Nothing is bookable in the next two months"
        description={`${business.name} has no openings for this service inside its booking window. Its opening hours are on the main page — you may have better luck with a shorter service.`}
        action={
          <Button variant="outline" asChild>
            {/* `Link`, not `<a href>`: a plain anchor reloads the document,
                throws away the query cache and re-runs the auth bootstrap to
                move between two routes of the same app. */}
            <Link to={`/b/${slug}`}>See opening hours</Link>
          </Button>
        }
      />
    )
  }

  return (
    <EmptyState
      icon={CalendarSearch}
      title="No times this week"
      description="This week is fully booked or outside the opening hours. There may be something later."
      action={
        <Button onClick={() => void findNextOpening()} disabled={searching}>
          {searching ? 'Searching…' : 'Find the next opening'}
        </Button>
      }
    />
  )
}

/**
 * What has been chosen, and the button that does not work yet.
 *
 * Wave 3 ends here on purpose: this wave proves a customer can reach a real slot
 * from the real engine. The details form, the deposit and the booking call are
 * wave 4, and shipping a Continue button that went nowhere would be worse than
 * one that is visibly not ready.
 */
function SelectionBar({ business, selected }: { business: PublicBusiness; selected: Slot | null }) {
  if (!selected) return null

  return (
    <div className="border-rule bg-card sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t py-4">
      {/* `status`, so choosing a slot is announced without stealing focus from
          the grid the arrow keys are still walking. */}
      <p role="status" className="text-sm">
        <span className="text-muted-foreground">Selected </span>
        <span className="text-foreground font-medium">
          {/* The day in the business's zone, not the viewer's — the same rule
              the grid headings follow. */}
          {formatDayHeading(dayKeyOf(selected.start, business.timezone))} at{' '}
          {clockOf(selected.start, business.timezone)}
        </span>
      </p>
      <Button size="lg" disabled>
        Continue
      </Button>
    </div>
  )
}
