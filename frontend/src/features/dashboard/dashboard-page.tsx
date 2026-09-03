import { useQueryClient } from '@tanstack/react-query'

import { describeError, requestIdOf } from '@/api/error-copy'
import { referenceKeys } from '@/api/reference'
import { Container } from '@/components/container'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { useAuth } from '@/hooks/use-auth'
import { useDashboardStats, useDashboardWeek } from '@/features/dashboard/dashboard-queries'
import { FigureBand } from '@/features/dashboard/figure-band'
import { UpcomingError, UpcomingList } from '@/features/dashboard/upcoming-list'
import { WeekPicker } from '@/features/dashboard/week-picker'
import { useLookups } from '@/hooks/use-lookups'
import type { MeResponse } from '@/types'
import { useTranslation } from '@/i18n'

/**
 * Screen 5: the numbers a business opens in the morning.
 *
 * Two things this screen refuses to do, and both are refusals rather than
 * omissions:
 *
 * **Nothing here is computed from a list of bookings.** Every figure is defined
 * server-side in one SQL projection. A client-side count over `/api/bookings`
 * would agree with it most of the time and disagree on a boundary day, in the
 * business timezone, for an appointment that straddles midnight — the single
 * hardest disagreement to notice and the most embarrassing to explain.
 *
 * **The role difference is shown, not hidden.** A `STAFF` token gets the same
 * endpoint scoped to its own bookings, so the same URL answers with smaller
 * numbers for Amélie than for the owner. The line under the heading says which
 * of the two you are reading, because the demo is logged into both and an
 * unexplained difference reads as a bug.
 */
export function DashboardPage() {
  const { user } = useAuth()

  // `RequireAuth` is above this route, so a null user is unreachable. The guard
  // is here rather than a `!` because a non-null assertion would be a claim
  // about the route table made from a file that cannot see it.
  if (!user) return null

  return <Dashboard user={user} />
}

function Dashboard({ user }: { user: MeResponse }) {
  const queryClient = useQueryClient()
  const timeZone = user.business.timezone
  const currency = user.business.currency

  const week = useDashboardWeek(timeZone)
  const stats = useDashboardStats(week.range, timeZone)
  const lookups = useLookups()
  const { t } = useTranslation()

  return (
    <Container className="pb-12">
      <PageHeader
        eyebrow={t('admin.eyebrow')}
        title={t('dashboard.title')}
        description={
          user.role === 'OWNER'
            ? t('dashboard.descriptionOwner', { business: user.business.name })
            : t('dashboard.descriptionStaff')
        }
        actions={<WeekPicker week={week} />}
      />

      {stats.error && stats.data === undefined ? (
        // One error, not two. `upcoming` arrives inside this same response, so a
        // failure here is a failure of both surfaces and saying so twice would
        // just be the same sentence in two boxes.
        //
        // `data === undefined` and not `stats.error` alone: a query keeps its
        // last response when a later fetch fails, and this screen refetches on
        // window focus and on reconnect. Without the guard, an owner who leaves
        // the dashboard open all morning has the whole thing replaced by an
        // error box the first time a focus refetch times out — over figures
        // that are on screen, correct, and stamped with the week they are for.
        <ErrorState
          title={t('dashboard.errorTitle')}
          description={describeError(stats.error)}
          requestId={requestIdOf(stats.error)}
          onRetry={() => void stats.refetch()}
        />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <FigureBand stats={stats.data} currency={currency} />

          {lookups.error ? (
            <UpcomingError
              error={lookups.error}
              onRetry={() => void queryClient.invalidateQueries({ queryKey: referenceKeys.all })}
            />
          ) : (
            <UpcomingList
              // Undefined until **both** have answered. The rows carry names and
              // names come from the lookups, which makes them a loading
              // dependency of this surface rather than a detail of it — the
              // skeleton has to cover them, or the list lands as a flash of ids.
              bookings={stats.data && !lookups.isLoading ? stats.data.upcoming : undefined}
              lookups={lookups}
              timeZone={timeZone}
              slug={user.business.slug}
            />
          )}
        </div>
      )}
    </Container>
  )
}
