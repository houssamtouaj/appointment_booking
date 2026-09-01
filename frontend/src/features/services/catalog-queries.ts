import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import {
  createService,
  deactivateService,
  fetchServicePage,
  reactivateService,
  serviceKeys,
  updateService,
} from '@/api/catalog'
import { describeError, referenceNote } from '@/api/error-copy'
import { referenceKeys } from '@/api/reference'
import { tabQuery, type ServiceTab } from '@/features/services/service-params'
import type { Service, ServiceRequest, ServiceUpdateRequest } from '@/types'

/**
 * Every read and write the catalogue screen makes.
 *
 * The one rule that runs through all of them is the wave's gate item: **every
 * mutation invalidates `useLookups()`**. A service renamed here is a service
 * named on forty calendar tiles, and a cache that kept the old name would make
 * the two screens disagree until a reload — which reads as the calendar being
 * wrong rather than as the cache being old. It is one line, it is easy to leave
 * out of exactly one mutation, and {@link invalidateCatalog} is why there is only
 * one place it can be left out of.
 */

/** Twenty rows is a screenful; the endpoint's own default is a truncating 20. */
export const CATALOG_PAGE_SIZE = 20

/**
 * The catalogue page, and the lookups, and nothing else.
 *
 * Not the bookings: a service's name, price and buffers are all *snapshotted*
 * onto a booking when it is taken (backend D14), so editing the catalogue cannot
 * change an appointment that already exists and invalidating the calendar's
 * weeks would be a refetch that provably changes nothing.
 */
function invalidateCatalog(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: serviceKeys.all })
  void client.invalidateQueries({ queryKey: referenceKeys.all })
}

/**
 * One tab, one page.
 *
 * **No `placeholderData`.** Keeping the previous tab's rows on screen while the
 * next tab loads would put archived services under the Active heading for a
 * frame, which is the one confusion this screen exists to prevent.
 */
export function useServicePage(tab: ServiceTab, page: number) {
  const query = { ...tabQuery(tab), page, size: CATALOG_PAGE_SIZE }

  return useQuery({
    queryKey: serviceKeys.list(query),
    queryFn: ({ signal }) => fetchServicePage(query, signal),
  })
}

/**
 * `POST /api/services`. Bare — no toast and no error handling.
 *
 * The dialog owns both, because a create can fail with a `422` that belongs on a
 * field rather than in a banner, and a mutation that had already fired a toast
 * would be telling the person something the form is about to tell them better.
 */
export function useCreateService() {
  const client = useQueryClient()

  return useMutation({
    mutationFn: (request: ServiceRequest) => createService(request),
    onSuccess: () => invalidateCatalog(client),
  })
}

/** `PATCH /api/services/{id}`, on the same terms as {@link useCreateService}. */
export function useUpdateService() {
  const client = useQueryClient()

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: ServiceUpdateRequest }) =>
      updateService(id, request),
    onSuccess: () => invalidateCatalog(client),
  })
}

/**
 * What a row's own buttons do: archive, restore, and assign a colleague.
 *
 * One mutation for the three of them rather than three, because they share
 * everything that matters — the same invalidation, the same failure copy, and
 * the same need to say *which* service it was in the confirmation. What differs
 * is one sentence, and that is what `describe` is.
 *
 * A toast rather than an inline alert, and this is the wave's other decision
 * about toasts read the right way round: the plan says a *deactivation warning*
 * must not be a toast, because it is information an owner has to act on. "Coupe
 * classique is archived" is not that — it is the confirmation of something the
 * row already shows, and the row moving to another tab is the real feedback.
 */
export function useServiceAction() {
  const client = useQueryClient()

  return useMutation({
    mutationFn: (action: ServiceAction) => runServiceAction(action),
    onSuccess: (service, action) => {
      invalidateCatalog(client)
      toast.success(describeServiceAction(action, service))
    },
    onError: (error) => {
      toast.error(describeError(error), {
        description: referenceNote(error),
      })
    },
  })
}

export type ServiceAction =
  | { kind: 'deactivate'; service: Service }
  | { kind: 'reactivate'; service: Service }
  /**
   * The chip's one-click fix. `staffIds` **replaces** the whole assignment set,
   * so the existing ids are sent back with the new one appended — a patch
   * carrying only the newly ticked colleague would silently unassign everybody
   * else who performs it.
   */
  | { kind: 'assign'; service: Service; staffId: string }

function runServiceAction(action: ServiceAction): Promise<Service> {
  switch (action.kind) {
    case 'deactivate':
      return deactivateService(action.service.id)
    case 'reactivate':
      return reactivateService(action.service.id)
    case 'assign':
      return updateService(action.service.id, {
        staffIds: [...action.service.staffIds, action.staffId],
      })
  }
}

function describeServiceAction(action: ServiceAction, service: Service): string {
  switch (action.kind) {
    case 'deactivate':
      // Says where it went. The row has just left the tab it was on, and an
      // owner who did not expect that needs to know it is not gone.
      return `${service.name} is archived. It is under Archived and off your booking page.`
    case 'reactivate':
      return `${service.name} is back in the catalogue.`
    case 'assign':
      // `bookable` is the server's answer, not a guess: assigning somebody who
      // has themselves been deactivated changes nothing about bookability, and
      // claiming otherwise would be the exact mystery this screen removes.
      return service.bookable
        ? `${service.name} is bookable now.`
        : `Assigned. ${service.name} is still not bookable — everyone on it is deactivated.`
  }
}
