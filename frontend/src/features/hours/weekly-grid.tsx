import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { isApiError, problemText } from '@/api/error'
import { describeError, referenceNote } from '@/api/error-copy'
import { dayOfWeekSchema } from '@/api/schemas/public'
import { Button } from '@/components/ui/button'
import { DayRow } from '@/features/hours/day-row'
import { RemovalConfirm, UnsavedChangesConfirm } from '@/features/hours/hours-dialogs'
import {
  addRange,
  copyDay,
  draftFrom,
  draftToRequest,
  isDirty,
  MAX_RANGES,
  overlappingDays,
  rangeCount,
  rangeProblem,
  removeRange,
  setRange,
  toggleDay,
  type HoursDraft,
} from '@/features/hours/hours-model'
import { useReplaceWorkingHours } from '@/features/hours/hours-queries'
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes'
import { formatWeekday } from '@/lib/time'
import type { DayOfWeek, WorkingHoursRange } from '@/types'

type WeeklyGridProps = {
  staffId: string
  /** Whose hours these are, for the copy that names them. */
  staffName: string
  saved: readonly WorkingHoursRange[]
}

/**
 * The seven-row weekly template, and the sentence it owes the reader before the
 * button is pressed: **saving replaces the whole week.**
 *
 * That is said three times, on purpose, because it is the one thing about this
 * screen that is not guessable from looking at it — a form with a per-day toggle
 * looks exactly like a form that patches one day. It is said as a standing note
 * above the grid, in the Save button's own hint, and as a dialog naming the days
 * a save is about to empty.
 *
 * Overlap is checked here as well as by the server, and the two are not the same
 * kind of thing (overview rule 1): the client check is an affordance so the
 * collision shows while somebody is dragging, and `422 HOURS_OVERLAP` is the
 * rule. The refusal is handled below even for a body this check passed, because
 * the client's copy of a server rule is a mirror and a mirror can be wrong.
 */
export function WeeklyGrid({ staffId, staffName, saved }: WeeklyGridProps) {
  const replace = useReplaceWorkingHours(staffId)

  const baseline = useMemo(() => draftFrom(saved), [saved])
  const [draft, setDraft] = useState<HoursDraft>(baseline)
  /** The weekday the *server* named in a 422, which the client check had let through. */
  const [refusedDay, setRefusedDay] = useState<DayOfWeek | null>(null)
  const [confirming, setConfirming] = useState<readonly DayOfWeek[] | null>(null)

  const dirty = isDirty(draft, baseline)
  const guard = useUnsavedChanges(dirty)

  const overlaps = overlappingDays(draft)
  const malformed = draft.some((day) => day.ranges.some((range) => rangeProblem(range)))
  const total = rangeCount(draft)
  const blocked = overlaps.size > 0 || malformed || total > MAX_RANGES

  /** Days that have hours today and would have none after this save. */
  const removals = baseline
    .filter((day) => day.ranges.length > 0)
    .filter((day) => draft.find((row) => row.dayOfWeek === day.dayOfWeek)?.ranges.length === 0)
    .map((day) => day.dayOfWeek)

  /**
   * Every edit to the grid goes through here, so the server's mark cannot
   * outlive the row it named.
   *
   * `refusedDay` is a fact about a body that was *sent* — the weekday a `422`
   * found an overlap on. The moment somebody changes the grid it is a mark on a
   * week the server has never seen: the row stays red and keeps claiming "these
   * hours overlap something else in the week" after the collision has been
   * fixed, with nothing but another save able to clear it.
   */
  function edit(next: HoursDraft) {
    setDraft(next)
    setRefusedDay(null)
  }

  function save() {
    setConfirming(null)
    setRefusedDay(null)

    replace.mutate(draftToRequest(draft), {
      onSuccess: (result) => {
        // Re-baselined from the server's answer, not from the draft: the two
        // agree today, and the day they do not, the grid should show what was
        // stored rather than what was sent.
        setDraft(draftFrom(result.ranges))
        toast.success(`${staffName}'s week is saved.`, {
          description:
            removals.length > 0
              ? `${removals.map((day) => formatWeekday(day)).join(', ')} now ${removals.length === 1 ? 'has' : 'have'} no hours.`
              : undefined,
        })
      },
      onError: (error) => {
        if (isApiError(error, 'HOURS_OVERLAP')) {
          // The server names the weekday it found, and the grid marks it. Parsed
          // rather than cast: it is an extension member with no published
          // schema, so a value that is not one of seven must mark nothing rather
          // than a row that does not exist.
          setRefusedDay(dayOfWeekSchema.safeParse(problemText(error, 'dayOfWeek')).data ?? null)
        }
        toast.error(
          describeError(error, {
            HOURS_OVERLAP: 'errors.hoursOverlapUnsaved',
            ACCESS_DENIED: 'errors.hoursOnlyYourOwn',
          }),
          { description: referenceNote(error) },
        )
      },
    })
  }

  const marked = new Set(overlaps)
  if (refusedDay) marked.add(refusedDay)

  return (
    <section aria-labelledby="weekly-hours" className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="weekly-hours" className="font-display text-foreground text-lg">
          Weekly hours
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={replace.isPending}
            onClick={() => edit(copyDay(draft, 'MONDAY', 'weekdays'))}
          >
            Copy Monday to weekdays
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={replace.isPending}
            onClick={() => edit(copyDay(draft, 'MONDAY', 'all'))}
          >
            Copy Monday to all days
          </Button>
        </div>
      </div>

      {/* The rule, stated where somebody is about to break it. */}
      <p className="border-info/40 bg-info-wash text-foreground mt-3 rounded-sm border px-3 py-2 text-sm">
        <strong className="font-medium">Saving replaces the whole week.</strong> Every day is sent
        together, so a day switched off here loses its hours — this form does not edit one day at a
        time.
      </p>

      <ul className="border-rule mt-2 border-t">
        {draft.map((day) => (
          <DayRow
            key={day.dayOfWeek}
            day={day}
            overlapping={marked.has(day.dayOfWeek)}
            full={total >= MAX_RANGES}
            disabled={replace.isPending}
            onToggle={() => edit(toggleDay(draft, day.dayOfWeek))}
            onAdd={() => edit(addRange(draft, day.dayOfWeek))}
            onRemove={(key) => edit(removeRange(draft, day.dayOfWeek, key))}
            onChange={(key, edge, value) => edit(setRange(draft, day.dayOfWeek, key, edge, value))}
          />
        ))}
      </ul>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs" aria-live="polite">
          {blocked
            ? 'Fix the marked rows before saving.'
            : dirty
              ? 'Unsaved changes. Saving sends all seven days.'
              : 'Everything here matches what is saved.'}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!dirty || replace.isPending}
            onClick={() => edit(baseline)}
          >
            Discard changes
          </Button>
          <Button
            disabled={!dirty || blocked || replace.isPending}
            onClick={() => (removals.length > 0 ? setConfirming(removals) : save())}
          >
            {replace.isPending ? 'Saving…' : 'Save the week'}
          </Button>
        </div>
      </div>

      {confirming ? (
        <RemovalConfirm days={confirming} onConfirm={save} onCancel={() => setConfirming(null)} />
      ) : null}

      {guard.blocked ? (
        <UnsavedChangesConfirm onDiscard={guard.discard} onKeepEditing={guard.keepEditing} />
      ) : null}
    </section>
  )
}
