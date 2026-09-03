import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { styleOf } from '@/features/calendar/status-style'
import { serviceNameIn, staffNameIn, type Lookups } from '@/hooks/use-lookups'
import { clockOf, dayKeyOf, formatDayShort, formatWeekdayShort, weekdayOf } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { BookingPage } from '@/types'
import { useTranslation } from '@/i18n'

/**
 * The week as rows — for **finding** a booking rather than reading a day.
 *
 * The grid answers "what does Thursday look like"; this answers "where is the
 * appointment for Haddad". They are different questions and a grid is bad at the
 * second one, which is why this exists — and it is a third view of the same
 * screen rather than a tenth route, because the brief allots nine screens and
 * the calendar is one of them.
 *
 * It is the only one of the three that pages, because it is the only one where
 * paging makes sense: a week grid showing "the first 100 of 140" is a calendar
 * with a hole in it, while a list showing the first 20 of 140 is a list.
 */

type BookingListProps = {
  page?: BookingPage
  lookups: Lookups
  timeZone: string
  pageIndex: number
  onPage: (page: number) => void
  selectedId?: string
  onOpen: (id: string) => void
}

export function BookingList({
  page,
  lookups,
  timeZone,
  pageIndex,
  onPage,
  selectedId,
  onOpen,
}: BookingListProps) {
  const { t } = useTranslation()

  if (!page) return <ListSkeleton />

  return (
    <div className="space-y-3">
      <ol className="border-border bg-card overflow-hidden rounded-md border">
        {page.content.map((booking) => {
          const style = styleOf(booking.status)
          const Icon = style.icon
          const day = dayKeyOf(booking.startsAt, timeZone)

          return (
            <li key={booking.id} className="border-rule border-b last:border-b-0">
              <button
                type="button"
                data-booking-id={booking.id}
                onClick={() => onOpen(booking.id)}
                aria-current={booking.id === selectedId ? 'true' : undefined}
                className={cn(
                  'hover:bg-accent flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                  booking.id === selectedId && 'bg-accent',
                )}
              >
                {/* The status spine, in the same place and the same colour as on
                    the grid. A person moving between the two views should not
                    have to learn a second vocabulary. */}
                <span
                  aria-hidden="true"
                  className={cn('h-8 w-[3px] shrink-0 rounded-full', style.spine)}
                />

                <span className="text-muted-foreground w-16 shrink-0 font-mono text-xs">
                  <span className="block">
                    {formatWeekdayShort(weekdayOf(day))} {formatDayShort(day)}
                  </span>
                  <span className="text-foreground block text-sm">
                    {clockOf(booking.startsAt, timeZone)}
                  </span>
                </span>

                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'text-foreground block truncate text-sm font-medium',
                      booking.status === 'CANCELLED' && 'text-muted-foreground line-through',
                    )}
                  >
                    {booking.guestName}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {serviceNameIn(lookups, booking.serviceId)} ·{' '}
                    {staffNameIn(lookups, booking.staffId)}
                  </span>
                </span>

                {/* The status in words, not only as the spine's colour — this is
                    the view where a status is most often what is being looked
                    for, and a colour cannot be searched for by eye in greyscale. */}
                <span className="text-muted-foreground hidden shrink-0 items-center gap-1 text-xs sm:flex">
                  {Icon ? <Icon aria-hidden="true" className="size-3" /> : null}
                  {t(style.label)}
                </span>
              </button>
            </li>
          )
        })}
      </ol>

      <Pager page={page} pageIndex={pageIndex} onPage={onPage} />
    </div>
  )
}

/**
 * Previous, next, and where you are.
 *
 * `totalPages` is zero when there are no rows at all, so the count is stated
 * from `totalPages` rather than computed — and the whole pager hides when there
 * is one page, because a control that can only be inert is a control that
 * teaches people to stop reading controls.
 */
function Pager({
  page,
  pageIndex,
  onPage,
}: {
  page: BookingPage
  pageIndex: number
  onPage: (page: number) => void
}) {
  const { t } = useTranslation()
  if (page.totalPages <= 1) return null

  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-muted-foreground text-xs" aria-live="polite">
        Page {pageIndex + 1} of {page.totalPages} · {page.totalElements} appointments
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={pageIndex === 0}
          onClick={() => onPage(pageIndex - 1)}
        >
          {t('common.previous')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pageIndex >= page.totalPages - 1}
          onClick={() => onPage(pageIndex + 1)}
        >
          {t('common.next')}
        </Button>
      </div>
    </div>
  )
}

function ListSkeleton() {
  const { t } = useTranslation()
  return (
    <div className="border-border bg-card overflow-hidden rounded-md border">
      <span className="sr-only" role="status">
        {t('calendar.loadingWeek')}
      </span>
      {Array.from({ length: 8 }, (_, index) => (
        <div
          key={index}
          className="border-rule flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0"
        >
          <Skeleton className="h-8 w-[3px]" />
          <span className="w-16 shrink-0">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="mt-1 h-5 w-11" />
          </span>
          <span className="min-w-0 flex-1">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="mt-1 h-4 w-44" />
          </span>
        </div>
      ))}
    </div>
  )
}
