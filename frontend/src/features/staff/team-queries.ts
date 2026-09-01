import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { serviceKeys } from '@/api/catalog'
import { describeError, referenceNote } from '@/api/error-copy'
import { fetchTeam, referenceKeys } from '@/api/reference'
import { inviteStaff, resendInvitation, updateStaff } from '@/api/staff'
import { REFERENCE_STALE_TIME } from '@/hooks/use-lookups'
import type { InviteStaffRequest, Staff, StaffUpdateResponse, UpdateStaffRequest } from '@/types'

/**
 * The team screen's read and its three writes.
 *
 * **The read is the reference cache**, not a second query. `GET /api/staff` is a
 * plain unpaged array that already includes deactivated people, which is exactly
 * this screen's list *and* exactly what `useLookups()` fetches for the calendar's
 * names — so mounting the same key means one request serves both, and every
 * mutation below has one entry to invalidate rather than two that can disagree.
 *
 * The catalogue's list is deliberately not shared that way (see
 * `api/catalog.ts`): it is paged and filtered, and the lookups want it whole.
 * Two endpoints, two shapes, two decisions.
 */
export function useTeam() {
  return useQuery({
    queryKey: referenceKeys.staff,
    queryFn: ({ signal }) => fetchTeam(signal),
    staleTime: REFERENCE_STALE_TIME,
  })
}

/**
 * **The services list too**, and this is the wave's subtlest watch-out.
 *
 * `bookable` is computed as *active and at least one **active** performer*, so
 * deactivating a colleague silently flips `bookable: false` on every service they
 * were the only performer of. Invalidating only the team would leave the two
 * screens disagreeing until a reload — the catalogue still saying Bookable about
 * a service that now offers nothing, which is the exact silence this wave exists
 * to remove. It costs one line and it is invisible when it is missing.
 *
 * A rename and a role change cannot change bookability, and this invalidates for
 * those too rather than branching: the cost is one refetch of a page of services,
 * and the alternative is a condition that has to be revisited every time the
 * backend's `bookable` gains a clause.
 */
function invalidateTeam(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: referenceKeys.all })
  void client.invalidateQueries({ queryKey: serviceKeys.all })
}

/**
 * `POST /api/staff/invite`. Bare — the dialog owns the copy, because
 * `409 EMAIL_TAKEN` needs a sentence about one account per person rather than
 * a toast saying "conflict".
 */
export function useInviteStaff() {
  const client = useQueryClient()

  return useMutation({
    mutationFn: (request: InviteStaffRequest) => inviteStaff(request),
    onSuccess: () => invalidateTeam(client),
  })
}

/**
 * `POST /api/staff/{id}/invite/resend`, from the row.
 *
 * A toast, and it says the thing that is easy to get wrong: the previous link
 * stops working. The API invalidates every outstanding invitation before issuing
 * the new one, so a colleague who still has the first mail open will find it
 * refused — better said now than discovered by them.
 */
export function useResendInvitation() {
  const client = useQueryClient()

  return useMutation({
    mutationFn: (person: Staff) => resendInvitation(person.id),
    onSuccess: (person) => {
      invalidateTeam(client)
      toast.success(`A fresh invitation is on its way to ${person.email}.`, {
        description: 'It is valid for seven days. Any earlier link no longer works.',
      })
    },
    onError: (error) => {
      // The two 409s here arrive with prose worth showing: "already accepted",
      // and "accepted before and was deactivated — reactivate them instead".
      // `describeError` falls through to the server's `detail` for
      // `DATA_CONFLICT`, which is what that is.
      toast.error(describeError(error), {
        description: referenceNote(error),
      })
    },
  })
}

/**
 * `PATCH /api/staff/{id}` → `{ staff, warning? }`.
 *
 * Bare of copy on purpose, and unusually so for a mutation this file owns: the
 * answer is not "done", it is *what happened*, and the `warning` has to be
 * rendered as a persistent alert with an undo rather than announced and lost.
 * Every caller therefore handles its own success — the edit dialog closes, the
 * row's Reactivate says so in a toast, and the page keeps the warning.
 */
export function useUpdateStaff() {
  const client = useQueryClient()

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: UpdateStaffRequest }) =>
      updateStaff(id, request),
    onSuccess: (result: StaffUpdateResponse) => {
      invalidateTeam(client)
      return result
    },
  })
}
