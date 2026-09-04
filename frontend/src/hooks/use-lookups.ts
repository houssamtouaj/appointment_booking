import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { fetchServices, fetchTeam, referenceKeys } from '@/api/reference'
import type { Service, Staff } from '@/types'
import { translate } from '@/i18n'

/**
 * The single reference-data cache (F7): two queries, two maps, one hook.
 *
 * **Two requests per session, not two per screen.** That is a gate item and it
 * is not enforced by anything clever — it falls out of both queries living under
 * fixed keys with a long `staleTime`, so the dashboard, the calendar and the
 * catalogue all mount the same two entries and the second screen mounts nothing.
 * The thing that would break it is a caller passing its own key or its own
 * `staleTime`, which is why the fetches are not exported as hooks individually.
 *
 * It lives in `hooks/` rather than in a feature folder on purpose. Three
 * features consume it, and putting it under any one of them would make the other
 * two import across a feature boundary — which is how the second copy gets
 * written.
 */

/**
 * Five minutes. A catalogue changes when an owner edits it, which is not while
 * somebody is moving between the dashboard and the calendar. The app-wide
 * default is thirty seconds and would refetch both lists on every such move.
 *
 * Staleness is bounded on the write side rather than here: wave 7's mutations
 * invalidate `referenceKeys.all`, so an edit is visible immediately and this
 * number only governs how long a *stale-by-someone-else's-edit* name survives.
 */
export const REFERENCE_STALE_TIME = 5 * 60_000

export type Lookups = {
  /** Every service the tenant has ever had, archived ones included. */
  serviceById: ReadonlyMap<string, Service>
  /** Every colleague, deactivated ones included. */
  staffById: ReadonlyMap<string, Staff>
  /**
   * True until **both** lists have answered. A screen that renders bookings has
   * to wait on this before it renders names, which makes it a loading dependency
   * of that surface rather than a detail — the skeleton has to cover it, or the
   * list lands as a flash of ids.
   */
  isLoading: boolean
  /**
   * The first failure of either, **and only while it leaves the surface unable
   * to resolve names**.
   *
   * A query that has answered once keeps its rows when a later fetch fails, so
   * `useQuery().error` outlives the data being useful: a refetch on reconnect
   * that times out would otherwise replace a list of correctly-named bookings
   * with an error box, over names that are still in the cache and still right.
   * Reporting nothing in that case is what makes this "the surface cannot
   * render" rather than "something went wrong somewhere".
   */
  error: unknown
}

export function useLookups(): Lookups {
  const services = useQuery({
    queryKey: referenceKeys.services,
    queryFn: ({ signal }) => fetchServices(signal),
    staleTime: REFERENCE_STALE_TIME,
  })

  const staff = useQuery({
    queryKey: referenceKeys.staff,
    queryFn: ({ signal }) => fetchTeam(signal),
    staleTime: REFERENCE_STALE_TIME,
  })

  const serviceById = useMemo(() => byId(services.data), [services.data])
  const staffById = useMemo(() => byId(staff.data), [staff.data])

  const resolved = services.data !== undefined && staff.data !== undefined

  return {
    serviceById,
    staffById,
    isLoading: services.isPending || staff.isPending,
    error: resolved ? null : (services.error ?? staff.error),
  }
}

function byId<T extends { id: string }>(rows: readonly T[] | undefined): ReadonlyMap<string, T> {
  return new Map((rows ?? []).map((row) => [row.id, row]))
}

/**
 * The name, or a phrase that says the lookup missed.
 *
 * Not the raw id and not an empty string. Both lists are fetched unfiltered
 * precisely so this cannot happen, so a miss means something is genuinely wrong
 * — a service beyond the first page, or a row from a tenant this session should
 * never have seen — and the screen should say so in words rather than print a
 * UUID at a person or leave a gap they read as a rendering bug.
 */
export function serviceNameIn(lookups: Lookups, serviceId: string): string {
  return lookups.serviceById.get(serviceId)?.name ?? translate('common.unknownService')
}

export function staffNameIn(lookups: Lookups, staffId: string): string {
  return lookups.staffById.get(staffId)?.fullName ?? translate('common.unknownColleague')
}
