import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { businessKeys, fetchBusiness, updateBusiness } from '@/api/business'
import { fetchPolicy, policyKeys, updatePolicy } from '@/api/policy'
import { useAuth } from '@/hooks/use-auth'
import type { BusinessRequest, PolicyRequest } from '@/types'

/**
 * The settings screen's two reads and two writes.
 *
 * Both writes are bare of copy. Each has an outcome the mutation cannot phrase:
 * the business `PUT` answers a timezone change with a `409` that is a *question*
 * rather than a failure, and the policy `PUT` answers with four numbers whose
 * confirmation is the preview line the form already draws. So the forms own both
 * halves and this file owns the cache.
 */

export function useBusinessSettings() {
  return useQuery({
    queryKey: businessKeys.all,
    queryFn: ({ signal }) => fetchBusiness(signal),
  })
}

export function usePolicySettings() {
  return useQuery({
    queryKey: policyKeys.all,
    queryFn: ({ signal }) => fetchPolicy(signal),
  })
}

/**
 * `PUT /api/business`.
 *
 * **A timezone change invalidates essentially everything, so it invalidates
 * everything.** That is the wave plan's instruction and it is the right shape:
 * the zone decides what "Tuesday" and "09:00" mean on every admin screen, so a
 * curated list of keys would be a list that falls out of date the first time a
 * wave adds a query — and the cost of the wholesale call is a refetch of
 * whatever is currently mounted, once, after a setting nobody changes twice.
 *
 * `refreshUser()` is the other half, and it is not optional. The tenant's name,
 * timezone and currency live on `MeResponse.business`, which is React state in
 * `AuthProvider` rather than query state, so no amount of invalidation reaches
 * it. Without this the shell keeps the old name and — the visible bug — the
 * calendar keeps drawing days in the old zone until a reload.
 *
 * The rest of the time, only the business entry is stale. A rename does not move
 * a slot.
 */
export function useUpdateBusiness() {
  const client = useQueryClient()
  const { refreshUser } = useAuth()

  return useMutation({
    mutationFn: (request: BusinessRequest) => updateBusiness(request),
    onSuccess: async (saved, request) => {
      client.setQueryData(businessKeys.all, saved)
      // `confirmShift` is only ever true on the resubmission of a zone change,
      // so it is the honest signal for "this one moved the clocks" — truer than
      // comparing the two strings, which would also fire for a request that was
      // never refused because the zone had not in fact changed.
      if (request.confirmShift) client.invalidateQueries()
      await refreshUser()
    },
  })
}

/** `PUT /api/policy`. One key; the calendar reads the same entry for its row pitch. */
export function useUpdatePolicy() {
  const client = useQueryClient()

  return useMutation({
    mutationFn: (request: PolicyRequest) => updatePolicy(request),
    onSuccess: (saved) => client.setQueryData(policyKeys.all, saved),
  })
}
