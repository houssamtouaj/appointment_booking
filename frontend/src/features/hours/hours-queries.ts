import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import {
  availabilityKeys,
  createBusinessClosure,
  createStaffOverride,
  deleteOverride,
  deleteStaffOverride,
  fetchOverrides,
  fetchWorkingHours,
  replaceWorkingHours,
} from '@/api/availability'
import { describeError, requestIdOf } from '@/api/error-copy'
import { publicKeys } from '@/api/public'
import type { Override, OverrideRequest, WorkingHoursRequest } from '@/types'

/**
 * The availability screen's reads and writes.
 *
 * The rule that runs through every mutation here is the one the calendar's
 * mutations do not have to think about: **a change to hours or overrides changes
 * what the public booking page offers.** A slot picker cached three minutes ago
 * is now wrong in a way nothing on the admin side would ever correct, and the
 * wave's demo walks straight from this screen to `/b/demo-salon`. So
 * {@link invalidateAvailability} clears the public namespace as well as this
 * one, and it is the only place either is spelled out.
 *
 * What is **not** invalidated: the booking lists. Availability is a statement
 * about slots that could be taken, and an appointment that already exists is
 * unaffected by the week's shape changing underneath it — the engine does not
 * retroactively cancel anything, and a refetch of the calendar would provably
 * change nothing.
 */
function invalidateAvailability(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: availabilityKeys.all })
  void client.invalidateQueries({ queryKey: publicKeys.all })
}

// ---------------------------------------------------------------------------
//  The weekly template
// ---------------------------------------------------------------------------

export function useWorkingHours(staffId: string) {
  return useQuery({
    queryKey: availabilityKeys.hours(staffId),
    queryFn: ({ signal }) => fetchWorkingHours(staffId, signal),
  })
}

/**
 * `PUT` the whole week.
 *
 * Bare of copy, unusually for this file: the grid owns both outcomes because
 * `422 HOURS_OVERLAP` has to mark the offending row rather than float past in a
 * toast, and the success message has to name what was replaced. Everything that
 * *is* shared — the two invalidations — is here.
 */
export function useReplaceWorkingHours(staffId: string) {
  const client = useQueryClient()

  return useMutation({
    mutationFn: (request: WorkingHoursRequest) => replaceWorkingHours(staffId, request),
    onSuccess: (saved) => {
      // Seeded rather than only invalidated, so the grid re-baselines against
      // what the server actually stored — sorted Monday-first, seconds and all —
      // instead of against the draft it happened to send. Anything the server
      // normalised shows up immediately rather than on the next mount.
      client.setQueryData(availabilityKeys.hours(staffId), saved)
      invalidateAvailability(client)
    },
  })
}

// ---------------------------------------------------------------------------
//  Overrides
// ---------------------------------------------------------------------------

/**
 * Every override in a date range, both levels merged.
 *
 * `enabled` is deliberately absent: the range is derived synchronously from the
 * month on screen, so there is no window in which this could mount without one.
 * The watch-out it would guard against — a request with no `from`/`to`, which is
 * a 400 — is prevented by the range being a computed value rather than state
 * that arrives later.
 */
export function useOverrides(range: { from: string; to: string }) {
  return useQuery({
    queryKey: availabilityKeys.overrides(range),
    queryFn: ({ signal }) => fetchOverrides(range, signal),
  })
}

/**
 * Creating one, at either level. The scope is the endpoint, not a field —
 * `OverrideRequest` has no `staffId` and must not grow one.
 */
export type NewOverride =
  | { scope: 'staff'; staffId: string; request: OverrideRequest }
  | { scope: 'business'; request: OverrideRequest }

export function useCreateOverride() {
  const client = useQueryClient()

  return useMutation({
    mutationFn: (entry: NewOverride) =>
      entry.scope === 'staff'
        ? createStaffOverride(entry.staffId, entry.request)
        : createBusinessClosure(entry.request),
    onSuccess: () => invalidateAvailability(client),
  })
}

/**
 * Removing one, through whichever path the caller is entitled to use.
 *
 * An owner goes through `/api/exceptions/{id}` for everything, which is the
 * delete button on the merged list and reaches both levels. A staff member has
 * only their own path, and it refuses a row that is not theirs — so the *caller*
 * decides, from the session's role, rather than this guessing from the row.
 * Passing `staffId` is how a staff member says "mine".
 */
export type RemoveOverride = { override: Override; asStaff?: string }

export function useDeleteOverride() {
  const client = useQueryClient()

  return useMutation({
    mutationFn: ({ override, asStaff }: RemoveOverride) =>
      asStaff ? deleteStaffOverride(asStaff, override.id) : deleteOverride(override.id),
    onSuccess: () => {
      invalidateAvailability(client)
      toast.success('That override is gone. Availability is back to the weekly hours.')
    },
    onError: (error) => {
      toast.error(describeError(error), {
        description: requestIdOf(error) && `Reference ${requestIdOf(error)}`,
      })
    },
  })
}
