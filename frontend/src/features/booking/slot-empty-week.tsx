import { useQueryClient } from '@tanstack/react-query'
import { CalendarSearch } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'

import { describeError, requestIdOf } from '@/api/error-copy'
import { fetchAvailability, publicKeys } from '@/api/public'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { availabilityRequest, nextOpeningRange } from '@/features/booking/public-queries'
import { groupSlotsByDay, type DayKey } from '@/lib/time'
import type { PublicBusiness } from '@/types'

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
export function EmptyWeek({
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
