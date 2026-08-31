import { CalendarOff, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { describeError, requestIdOf } from '@/api/error-copy'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ExceptionDialog } from '@/features/hours/exception-dialog'
import { ExceptionRow } from '@/features/hours/exception-row'
import { useDeleteOverride, useOverrides } from '@/features/hours/hours-queries'
import {
  formatMonth,
  isMonthKey,
  monthOf,
  monthRange,
  shiftMonth,
} from '@/features/hours/month-range'
import { todayIn } from '@/lib/time'
import type { MeResponse } from '@/types'

type ExceptionsPanelProps = {
  staffId: string
  staffName: string
  user: MeResponse
}

/**
 * Holidays, days off, closures and late openings for one person — plus every
 * business-wide closure, which applies to them whether or not it names them.
 *
 * **The month is the range picker.** `?from=` and `?to=` are required on
 * `GET /api/exceptions`, and deriving them from a `yyyy-MM` in the URL means the
 * request can never be built without them — see `month-range.ts`. It also makes
 * a month somebody is looking at a thing they can link to, and the search param
 * deliberately does not trip the grid's unsaved-changes guard, which watches the
 * path.
 *
 * The list is filtered to **this person and the whole business**. The endpoint
 * merges every staff member's overrides in the tenant, which is right for a
 * shared calendar and wrong for a screen headed with one colleague's name: an
 * owner editing Amélie's hours does not need Marc's holiday in the middle of it.
 */
export function ExceptionsPanel({ staffId, staffName, user }: ExceptionsPanelProps) {
  const [params, setParams] = useSearchParams()
  const [adding, setAdding] = useState(false)

  const thisMonth = monthOf(todayIn(user.business.timezone))
  const requested = params.get('month')
  const month = isMonthKey(requested) ? requested : thisMonth
  const range = monthRange(month)

  const overrides = useOverrides(range)
  const remove = useDeleteOverride()

  const owner = user.role === 'OWNER'
  const rows = (overrides.data ?? []).filter(
    (entry) => entry.businessWide || entry.staffId === staffId,
  )

  function goToMonth(next: string) {
    setParams(
      (previous) => {
        const search = new URLSearchParams(previous)
        if (next === thisMonth) search.delete('month')
        else search.set('month', next)
        return search
      },
      { replace: true },
    )
  }

  return (
    <section aria-labelledby="exceptions" className="mt-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="exceptions" className="font-display text-foreground text-lg">
            One-off changes
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Holidays, days off and extra hours, on top of the weekly template.
          </p>
        </div>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" />
          Add an override
        </Button>
      </div>

      <div className="border-rule mt-4 flex items-center gap-2 border-y py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous month"
          onClick={() => goToMonth(shiftMonth(month, -1))}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <p className="text-foreground min-w-40 text-center text-sm font-medium" aria-live="polite">
          {formatMonth(month)}
        </p>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next month"
          onClick={() => goToMonth(shiftMonth(month, 1))}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
        {month === thisMonth ? null : (
          <Button variant="outline" size="sm" onClick={() => goToMonth(thisMonth)}>
            This month
          </Button>
        )}
      </div>

      <div className="mt-4">
        {overrides.isPending ? (
          <div className="grid gap-2">
            <span className="sr-only" role="status">
              Loading overrides
            </span>
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : overrides.error && overrides.data === undefined ? (
          <ErrorState
            title="These overrides could not be loaded"
            description={describeError(overrides.error)}
            requestId={requestIdOf(overrides.error)}
            onRetry={() => void overrides.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={CalendarOff}
            title={`Nothing changes in ${formatMonth(month)}`}
            description={`${staffName} works the weekly hours above, every day of this month. Add an override for a holiday, a day off or a late opening.`}
            action={
              <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                Add an override
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-2">
            {rows.map((override) => (
              <ExceptionRow
                key={override.id}
                override={override}
                // A staff member may remove their own and nobody else's — a
                // business-wide closure belongs to no person and is an owner's
                // to lift. The server refuses either way; this is so the button
                // is not offered for something that would only answer 403.
                removable={owner || !override.businessWide}
                busy={remove.isPending && remove.variables?.override.id === override.id}
                onRemove={() => remove.mutate({ override, asStaff: owner ? undefined : staffId })}
              />
            ))}
          </ul>
        )}
      </div>

      {adding ? (
        <ExceptionDialog
          staffId={staffId}
          staffName={staffName}
          canCloseBusiness={owner}
          defaultDate={month === thisMonth ? todayIn(user.business.timezone) : range.from}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </section>
  )
}
