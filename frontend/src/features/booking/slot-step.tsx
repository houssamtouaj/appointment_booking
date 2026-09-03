import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { describeError, requestIdOf } from '@/api/error-copy'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import {
  availabilityRequest,
  useAvailability,
  usePrefetchWeek,
  weekRangeFor,
} from '@/features/booking/public-queries'
import { EmptyWeek } from '@/features/booking/slot-empty-week'
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
import { useTranslation } from '@/i18n'

type SlotStepProps = {
  slug: string
  business: PublicBusiness
  serviceId: string
  staff: string
  /** The day whose week is showing. Absent means "this week, where the business is". */
  date?: DayKey
  onDateChange: (date: DayKey) => void
  /** Advance to step 4 with this slot's `start`, byte for byte as the API sent it. */
  onContinue: (slot: Slot) => void
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
export function SlotStep({
  slug,
  business,
  serviceId,
  staff,
  date,
  onDateChange,
  onContinue,
}: SlotStepProps) {
  const { t } = useTranslation()
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
   * because it goes onto an unmemoised element as an inline handler, so its
   * identity decides nothing: no child is wrapped in `memo` and no effect
   * depends on it.
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
            aria-label={t('booking.slotStep.previousWeek')}
            disabled={!canGoBack}
            onClick={() => onDateChange(previousWeekStart)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={t('booking.slotStep.nextWeek')}
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
            {t('booking.slotStep.loading')}
          </p>
          <SlotGridSkeleton />
        </>
      ) : isError ? (
        <ErrorState
          title={t('booking.slotStep.errorTitle')}
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

      <SelectionBar business={business} selected={selected} onContinue={onContinue} />
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
 * What has been chosen, and the way on.
 *
 * Sticky, because the grid is taller than a phone and the confirmation of what
 * was just tapped has to stay in view while the thumb is still near the chips.
 */
function SelectionBar({
  business,
  selected,
  onContinue,
}: {
  business: PublicBusiness
  selected: Slot | null
  onContinue: (slot: Slot) => void
}) {
  const { t } = useTranslation()

  if (!selected) return null

  return (
    <div className="border-rule bg-card sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t py-4">
      {/* `status`, so choosing a slot is announced without stealing focus from
          the grid the arrow keys are still walking. */}
      <p role="status" className="text-sm">
        {/* One sentence, and the day in the business's zone rather than the
            viewer's — the same rule the grid headings follow. "Selected" was its
            own span with the rest bolded beside it; French does not put the two
            in that order, so the emphasis went and the sentence stayed. */}
        {t('booking.slotStep.selected', {
          when: t('booking.summary.dateAtTime', {
            date: formatDayHeading(dayKeyOf(selected.start, business.timezone)),
            time: clockOf(selected.start, business.timezone),
          }),
        })}
      </p>
      <Button size="lg" onClick={() => onContinue(selected)}>
        {t('booking.slotStep.continue')}
      </Button>
    </div>
  )
}
