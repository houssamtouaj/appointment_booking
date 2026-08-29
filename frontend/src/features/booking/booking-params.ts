import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import { isDayKey, type DayKey } from '@/lib/time'

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
 * The parameters are `service`, `staff`, `date` and `slot`. Short names because
 * this URL gets pasted into messages, and a query string is part of the
 * interface when it does.
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

export type BookingStep = 'service' | 'staff' | 'slot' | 'details'

export type BookingParams = {
  serviceId?: string
  /** `undefined` until step 2 is answered; then a staff id or {@link ANYONE}. */
  staff?: string
  /** The day the picker is showing. Its week is what gets fetched. */
  date?: DayKey
  /**
   * The chosen slot's `start`, **verbatim from the availability response** —
   * the exact string that goes back as `startsAt`.
   *
   * It is a parameter for the same three reasons the others are, and one more.
   * A `409 BOOKING_SLOT_TAKEN` is an expected outcome of this flow, and the way
   * back to step 3 is then *clearing one parameter* rather than navigating:
   * `BookingFlowPage` stays mounted across a query-string change, so the contact
   * details already typed survive it with no state to lift, no draft to
   * serialise and nothing to restore. That is the gate item about preserving the
   * form, solved by where the state lives rather than by a mechanism.
   *
   * Never reformatted, rounded or re-derived from a wall clock. The backend
   * reads it back as an `Instant` and a start rebuilt from a local time and a
   * zone is how a booking lands an hour out on the last Sunday in March.
   */
  slot?: string
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
  if (!params.slot) return 'slot'
  return 'details'
}

/** What a link back to an earlier step should carry — everything up to it, nothing after. */
export function paramsForStep(params: BookingParams, step: BookingStep): BookingParams {
  if (step === 'service') return {}
  if (step === 'staff') return { serviceId: params.serviceId }
  // Back to the picker keeps the week being looked at and drops the choice made
  // in it. Keeping `slot` would land on step 4 again the instant it arrived.
  if (step === 'slot')
    return { serviceId: params.serviceId, staff: params.staff, date: params.date }
  return params
}

export function toSearch(params: BookingParams): string {
  const search = new URLSearchParams()
  if (params.serviceId) search.set('service', params.serviceId)
  if (params.staff) search.set('staff', params.staff)
  if (params.date) search.set('date', params.date)
  if (params.slot) search.set('slot', params.slot)
  const query = search.toString()
  return query ? `?${query}` : ''
}

/**
 * `yyyy-MM-dd`, and anything else is treated as absent rather than trusted.
 *
 * The impossible-date half of that — `2026-02-31` — is {@link isDayKey}'s job
 * rather than a `Date.parse` here, which looks like the same check and is not:
 * V8 rolls that date over to 3 March instead of rejecting it.
 */
function readDate(raw: string | null): DayKey | undefined {
  return raw && isDayKey(raw) ? raw : undefined
}

/**
 * An instant, or nothing.
 *
 * The check is not decoration. `?slot=` is pasted, edited and truncated, and an
 * unparseable one would otherwise reach the details step, render "Invalid Date"
 * where the appointment should be, and be sent to the API as `startsAt`. Falling
 * back to step 3 asks a question the customer can answer. It does not attempt to
 * verify the slot is *on offer* — that is the server's answer to give, and the
 * whole `422` half of the table below exists because it gives it.
 */
function readSlot(raw: string | null): string | undefined {
  if (!raw || Number.isNaN(Date.parse(raw))) return undefined
  return raw
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
      slot: readSlot(search.get('slot')),
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
