import { useQueryClient } from '@tanstack/react-query'
import { Archive, Plus, Tag } from 'lucide-react'
import { useState } from 'react'

import { describeError, requestIdOf } from '@/api/error-copy'
import { referenceKeys } from '@/api/reference'
import { Container } from '@/components/container'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/use-auth'
import {
  CATALOG_PAGE_SIZE,
  useServiceAction,
  useServicePage,
} from '@/features/services/catalog-queries'
import { ServiceFormDialog } from '@/features/services/service-form-dialog'
import {
  TAB_LABEL,
  TABS,
  useServiceParams,
  type ServiceTab,
} from '@/features/services/service-params'
import { ServiceRow } from '@/features/services/service-row'
import { useLookups } from '@/hooks/use-lookups'
import { cn } from '@/lib/utils'
import type { MeResponse, Service, ServicePage } from '@/types'

/**
 * Screen 7: what the business sells, and why something is not bookable.
 *
 * Owner-only end to end (F19). The wave-1 route table made this a shared route
 * on the argument that a staff member may *read* the catalogue and the check
 * belongs on the buttons; wave 7's plan settles it the other way — the demo's
 * last step requires that a `STAFF` session finds neither screen in the nav *and*
 * is redirected away from both URLs. So the route moved under `RequireOwner`, and
 * with the whole screen owner-only there is no per-button role check anywhere
 * below this file.
 *
 * The screen has one idea in it, and it is `BookableChip`: `bookable` is not
 * `active`, an active service that nobody performs sells nothing and says nothing
 * about it, and this is where that stops being a mystery.
 */
export function ServicesPage() {
  const { user } = useAuth()

  // `RequireAuth` is above this route, so a null user is unreachable. A guard
  // rather than a `!`, which would be a claim about the route table made from a
  // file that cannot see it.
  if (!user) return null

  return <Services user={user} />
}

function Services({ user }: { user: MeResponse }) {
  const queryClient = useQueryClient()
  const params = useServiceParams()
  const lookups = useLookups()
  const services = useServicePage(params.tab, params.page)
  const action = useServiceAction()

  /**
   * `undefined` for closed, `null` for "create", a service for "edit".
   *
   * Three states in one value rather than a boolean and a service, because the
   * pair can express a fourth state — open with nothing to edit — that has no
   * meaning and would render an empty create form over a row somebody clicked
   * Edit on.
   */
  const [editing, setEditing] = useState<Service | null | undefined>(undefined)

  const page = services.data
  const rows = page?.content
  /** Which row is mid-write, so only that row greys out rather than the list. */
  const busyId = action.isPending ? action.variables?.service.id : undefined

  return (
    <Container className="pb-12">
      <PageHeader
        eyebrow="Admin"
        title="Services"
        description={`What ${user.business.name} sells, how long each one takes and who performs it.`}
        actions={
          <Button onClick={() => setEditing(null)}>
            <Plus aria-hidden="true" />
            New service
          </Button>
        }
      />

      <Tabs tab={params.tab} onTab={params.setTab} />

      {/**
       * The lookups failing is **not** fatal here, unlike on the calendar.
       *
       * There, a booking with no name is an unidentifiable appointment and there
       * is nothing left worth rendering. Here every fact on the row — name,
       * price, duration, and `bookable` itself — comes from the catalogue
       * response; only the performers' faces and the chip's *reason* need the
       * team. So the list renders and this says what is missing, rather than
       * replacing a working screen with an error box.
       */}
      {lookups.error ? (
        <div
          role="alert"
          className="border-warning/50 bg-warning-wash text-foreground mb-4 flex flex-wrap items-center gap-3 rounded-sm border px-4 py-3 text-sm"
        >
          <p className="flex-1">
            Your team could not be loaded, so these rows cannot show who performs each service.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void queryClient.invalidateQueries({ queryKey: referenceKeys.all })}
          >
            Try again
          </Button>
        </div>
      ) : null}

      {services.isPending ? (
        <CatalogSkeleton />
      ) : services.error && page === undefined ? (
        <ErrorState
          title="Your services could not be loaded"
          description={describeError(services.error)}
          requestId={requestIdOf(services.error)}
          onRetry={() => void services.refetch()}
        />
      ) : rows && rows.length === 0 ? (
        <CatalogEmpty
          tab={params.tab}
          page={params.page}
          params={params}
          onCreate={() => setEditing(null)}
        />
      ) : (
        <>
          <ul className="grid gap-2">
            {(rows ?? []).map((service) => (
              <ServiceRow
                key={service.id}
                service={service}
                lookups={lookups}
                currency={user.business.currency}
                busy={busyId === service.id}
                onEdit={setEditing}
                onDeactivate={(target) => action.mutate({ kind: 'deactivate', service: target })}
                onReactivate={(target) => action.mutate({ kind: 'reactivate', service: target })}
                onAssign={(target, staffId) =>
                  action.mutate({ kind: 'assign', service: target, staffId })
                }
              />
            ))}
          </ul>

          {page ? <Pager page={page} pageIndex={params.page} onPage={params.setPage} /> : null}
        </>
      )}

      {editing !== undefined ? (
        <ServiceFormDialog
          // Keyed by the row, so opening Edit on a second service remounts the
          // form rather than showing the first one's values under the second
          // one's heading.
          key={editing?.id ?? 'new'}
          service={editing ?? undefined}
          lookups={lookups}
          currency={user.business.currency}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </Container>
  )
}

/**
 * Active / Archived / All, writing to the URL.
 *
 * `role="tablist"` is deliberately **not** used. ARIA tabs come with a keyboard
 * contract — arrow keys move between tabs, only the selected one is tabbable —
 * that this does not implement, and a widget that claims to be a tablist and
 * behaves like three buttons is worse for a screen-reader user than three honest
 * buttons. `aria-current` says which one you are on, which is the fact that
 * matters.
 */
function Tabs({ tab, onTab }: { tab: ServiceTab; onTab: (tab: ServiceTab) => void }) {
  return (
    <nav aria-label="Filter services" className="border-rule mb-4 flex gap-1 border-b">
      {TABS.map((candidate) => {
        const current = candidate === tab
        return (
          <button
            key={candidate}
            type="button"
            aria-current={current ? 'page' : undefined}
            onClick={() => onTab(candidate)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              current
                ? 'border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground border-transparent',
            )}
          >
            {TAB_LABEL[candidate]}
          </button>
        )
      })}
    </nav>
  )
}

/**
 * Nothing here — and which nothing it is.
 *
 * Four different empties, because the action differs in each. An empty *archive*
 * is good news and its action is to go back; an empty catalogue is the first
 * thing a new tenant sees and its action is the one button that fixes it; and a
 * page past the end of a list is a navigation mistake rather than an absence.
 */
function CatalogEmpty({
  tab,
  page,
  params,
  onCreate,
}: {
  tab: ServiceTab
  page: number
  params: { setTab: (tab: ServiceTab) => void; setPage: (page: number) => void }
  onCreate: () => void
}) {
  if (page > 0) {
    return (
      <EmptyState
        icon={Tag}
        title="There is nothing on this page"
        description="The list is shorter than it was. Go back to the first page."
        action={
          <Button variant="outline" size="sm" onClick={() => params.setPage(0)}>
            First page
          </Button>
        }
      />
    )
  }

  if (tab === 'archived') {
    return (
      <EmptyState
        icon={Archive}
        title="Nothing is archived"
        description="Services you deactivate land here. They keep their bookings and can be brought back."
        action={
          <Button variant="outline" size="sm" onClick={() => params.setTab('active')}>
            Back to active services
          </Button>
        }
      />
    )
  }

  return (
    <EmptyState
      icon={Tag}
      title={tab === 'active' ? 'No services yet' : 'Your catalogue is empty'}
      description="A service is one thing you sell: what it is called, how long it takes and what it costs. Nothing can be booked until there is one."
      action={
        // The same action as the header's button, in the place somebody looking
        // at an empty screen is actually looking.
        <Button onClick={onCreate}>
          <Plus aria-hidden="true" />
          New service
        </Button>
      }
    />
  )
}

function Pager({
  page,
  pageIndex,
  onPage,
}: {
  page: ServicePage
  pageIndex: number
  onPage: (page: number) => void
}) {
  if (page.totalPages <= 1) return null

  return (
    <div className="mt-4 flex items-center justify-between gap-3">
      <p className="text-muted-foreground text-xs" aria-live="polite">
        Page {pageIndex + 1} of {page.totalPages} · {page.totalElements} services
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={pageIndex === 0}
          onClick={() => onPage(pageIndex - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pageIndex >= page.totalPages - 1}
          onClick={() => onPage(pageIndex + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

/**
 * The shape of the list, not a spinner (F20). Five rows: enough to read as a
 * list, short enough that a two-service tenant does not watch the page shrink.
 */
function CatalogSkeleton() {
  return (
    <div className="grid gap-2">
      <span className="sr-only" role="status">
        Loading your services
      </span>
      {Array.from({ length: Math.min(5, CATALOG_PAGE_SIZE) }, (_, index) => (
        <div key={index} className="border-border bg-card rounded-md border px-4 py-3">
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-2 h-3 w-56" />
            </div>
            <Skeleton className="size-6 rounded-full" />
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}
