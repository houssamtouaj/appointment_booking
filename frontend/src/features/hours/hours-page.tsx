import { useEffect } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { describeError, requestIdOf } from '@/api/error-copy'
import { Container } from '@/components/container'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/use-auth'
import { ExceptionsPanel } from '@/features/hours/exceptions-panel'
import { useWorkingHours } from '@/features/hours/hours-queries'
import { WeeklyGrid } from '@/features/hours/weekly-grid'
import { useLookups } from '@/hooks/use-lookups'
import { zoneCity } from '@/lib/time'
import type { MeResponse } from '@/types'

/**
 * Screen 8's second half: one colleague's weekly template and their one-off
 * overrides, on one page.
 *
 * **The one admin route that is neither shared nor owner-only.** `RequireAuth`
 * is above it and `RequireOwner` deliberately is not: the rule here is "an
 * owner, or the person themselves", which depends on the id in the path and so
 * cannot be a route guard the way `/settings` can. The server enforces it in
 * `WorkingHoursService.requireOwnerOrSelf` — the annotation-free check its
 * javadoc explains — and this component enforces the same thing in the same
 * shape, one layer earlier, so a staff member who types a colleague's id gets a
 * sentence rather than a screen of 403s.
 */
export function HoursPage() {
  const { user } = useAuth()
  const { id } = useParams<{ id: string }>()

  // `RequireAuth` is above this route, so a null user is unreachable. A guard
  // rather than a `!`, which would be a claim about the route table made from a
  // file that cannot see it.
  if (!user || !id) return null

  return <Hours user={user} staffId={id} />
}

function Hours({ user, staffId }: { user: MeResponse; staffId: string }) {
  const own = staffId === user.id
  const refused = user.role !== 'OWNER' && !own

  // In an effect and not in the render body, for the reason `RequireOwner` gives
  // at length: a toast is a state update in a store outside React, and firing
  // one during render updates another component mid-render. The fixed `id` is
  // what keeps `StrictMode`'s double mount to one message.
  useEffect(() => {
    if (refused) {
      toast.error('You can only edit your own working hours.', { id: 'hours-self-only' })
    }
  }, [refused])

  if (refused) return <Navigate to={`/team/${user.id}/hours`} replace />

  return <HoursFor user={user} staffId={staffId} own={own} />
}

function HoursFor({ user, staffId, own }: { user: MeResponse; staffId: string; own: boolean }) {
  const hours = useWorkingHours(staffId)
  const lookups = useLookups()

  /**
   * The session's own name first, the roster second.
   *
   * A staff member editing their own hours already knows who they are, and
   * waiting on `GET /api/staff` to render the heading would make a screen they
   * are entitled to see depend on a list they only need for somebody else's
   * name. The fallback is a phrase rather than a UUID, on the same terms as
   * `staffNameIn`.
   */
  const staffName = own
    ? user.fullName
    : (lookups.staffById.get(staffId)?.fullName ?? 'This colleague')

  return (
    <Container className="pb-16">
      <PageHeader
        eyebrow="Availability"
        title={own ? 'Your working hours' : `${staffName}’s working hours`}
        description={`When ${own ? 'you are' : 'they are'} available to be booked, in ${zoneCity(user.business.timezone)} time. These are wall-clock hours: nine o'clock stays nine o'clock when the clocks change.`}
      />

      {hours.isPending ? (
        <div className="grid gap-2">
          <span className="sr-only" role="status">
            Loading the weekly hours
          </span>
          {Array.from({ length: 7 }, (_, index) => (
            <Skeleton key={index} className="h-12" />
          ))}
        </div>
      ) : hours.error && hours.data === undefined ? (
        <ErrorState
          title="These working hours could not be loaded"
          description={describeError(hours.error, {
            NOT_FOUND: 'errors.hoursColleagueNotYours',
            ACCESS_DENIED: 'errors.hoursOnlyYourOwn',
          })}
          requestId={requestIdOf(hours.error)}
          onRetry={() => void hours.refetch()}
        />
      ) : (
        <WeeklyGrid
          // Keyed on the person, so an owner moving from one colleague to the
          // next remounts the grid rather than showing the first one's draft
          // under the second one's name.
          key={staffId}
          staffId={staffId}
          staffName={staffName}
          saved={hours.data?.ranges ?? []}
        />
      )}

      <ExceptionsPanel staffId={staffId} staffName={staffName} user={user} />
    </Container>
  )
}
