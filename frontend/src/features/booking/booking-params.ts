import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import type { DayKey } from '@/lib/time'

/**
 * The booking flow's state, and it lives in the URL rather than in a context.
 *
 * Three things force that and any one of them would be enough. The back button
 * has to walk back through the steps instead of leaving the flow. A pasted link
 * has to reopen the same service, the same person and the same week — the demo
 * script copies the URL at step 3 into a new tab and expects it to land. And
 * wave 4's error recovery has to send someone from a failed booking back to step
 * 3 with every other choice intact, which a context loses on the navigation that
 * gets them there.
 *
 * The parameters are `service`, `staff` and `date`. Short names because this URL
 * gets pasted into messages, and a query string is part of the interface when it
 * does.
 */

/**
 * `staff=anyone` — a real value, not the absence of one.
 *
 * "No preference" and "not asked yet" are different states and the URL has to
 * tell them apart: the first means step 2 is answered and the picker may load,
 * the second means step 2 is still the current step. A missing parameter cannot
 * carry that difference, which is why the flow does not simply omit it.
 *
 * It never reaches the API. `staffId` is omitted from the request entirely when
 * this is the choice, so the server assigns and keeps its ability to balance
 * across the team.
 */
export const ANYONE = 'anyone'

export type BookingStep = 'service' | 'staff' | 'slot'

export type BookingParams = {
  serviceId?: string
  /** `undefined` until step 2 is answered; then a staff id or {@link ANYONE}. */
  staff?: string
  /** The day the picker is showing. Its week is what gets fetched. */
  date?: DayKey
}

/**
 * Which step the URL is describing.
 *
 * Derived rather than stored, so there is one source of truth and no way for a
 * `step=2` parameter to disagree with the choices beside it. It also gives the
 * stepper its "never forward past an unmade choice" rule for free: a URL with a
 * `date` but no `service` is simply the service step.
 */
export function stepOf(params: BookingParams): BookingStep {
  if (!params.serviceId) return 'service'
  if (!params.staff) return 'staff'
  return 'slot'
}

/** What a link back to an earlier step should carry — everything up to it, nothing after. */
export function paramsForStep(params: BookingParams, step: BookingStep): BookingParams {
  if (step === 'service') return {}
  if (step === 'staff') return { serviceId: params.serviceId }
  return params
}

export function toSearch(params: BookingParams): string {
  const search = new URLSearchParams()
  if (params.serviceId) search.set('service', params.serviceId)
  if (params.staff) search.set('staff', params.staff)
  if (params.date) search.set('date', params.date)
  const query = search.toString()
  return query ? `?${query}` : ''
}

/** `yyyy-MM-dd`, and anything else is treated as absent rather than trusted. */
function readDate(raw: string | null): DayKey | undefined {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined
  // A well-formed but impossible date — 2026-02-31 — would otherwise reach
  // date arithmetic and produce a week nobody asked for.
  return Number.isNaN(Date.parse(`${raw}T12:00:00Z`)) ? undefined : raw
}

export function useBookingParams(): {
  params: BookingParams
  step: BookingStep
  /** Merge a change into the URL. `undefined` clears a parameter. */
  setParams: (next: Partial<BookingParams>, options?: { replace?: boolean }) => void
} {
  const [search, setSearch] = useSearchParams()

  const params = useMemo<BookingParams>(
    () => ({
      serviceId: search.get('service') ?? undefined,
      staff: search.get('staff') ?? undefined,
      date: readDate(search.get('date')),
    }),
    [search],
  )

  const setParams = useCallback(
    (next: Partial<BookingParams>, options?: { replace?: boolean }) => {
      setSearch(toSearch({ ...params, ...next }).replace(/^\?/, ''), {
        replace: options?.replace ?? false,
      })
    },
    [params, setSearch],
  )

  return { params, step: stepOf(params), setParams }
}
