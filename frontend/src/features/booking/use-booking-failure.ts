import { useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'

import { applyFieldErrors } from '@/api/error'
import { describeBookingFailure, type BookingFailure } from '@/features/booking/booking-errors'
import type { BookingParams } from '@/features/booking/booking-params'
import type { GuestDetails, ValidationError } from '@/types'

/** A failure, and the choices it was about — see `visibleFailure`. */
export type FlowFailure = {
  failure: BookingFailure
  /** `params.slot` at the moment of the attempt. `undefined` is impossible here. */
  slot: string
  /** `params.serviceId` at the moment of the attempt. `undefined` is impossible here. */
  serviceId: string
  unmatched: ValidationError[]
}

export type BookingFailureControl = {
  /** The failure to render, or `undefined` when it no longer describes the screen. */
  visibleFailure: FlowFailure | undefined
  /** A failed `POST /bookings`: explain it, put what fits on the form, route back. */
  report: (caught: unknown, attempt: { slot: string; serviceId: string }) => void
  /** A `201`. */
  clear: () => void
}

/**
 * The six ways a booking does not work, and where each one sends the customer.
 *
 * Extracted from `booking-flow-page`, where it was the second of that
 * component's three jobs. It is a unit because the three parts only make sense
 * together: what happened, which step can fix it, and whether the sentence still
 * describes what is on screen.
 */
export function useBookingFailure(options: {
  timeZone: string
  /** For the field-level half of a 422. */
  form: UseFormReturn<GuestDetails>
  params: BookingParams
  setParams: (next: Partial<BookingParams>, options?: { replace?: boolean }) => void
}): BookingFailureControl {
  const { timeZone, form, params, setParams } = options
  const [failure, setFailure] = useState<FlowFailure | null>(null)

  function report(caught: unknown, attempt: { slot: string; serviceId: string }) {
    // Field-level messages first, so that a 422 lands under the input it is
    // about rather than only in the banner. What matches nothing comes back and
    // is shown, because React Hook Form accepts `setError` on an unregistered
    // path without complaint and the message would otherwise vanish.
    const unmatched = applyFieldErrors(caught, form, {
      // The three fields the details step owns. Everything else on a booking
      // request is chosen from the picker, so a 422 naming it is this client's
      // bug rather than something a guest can fix by reading a sentence.
      messageFor: {
        guestName: 'errors.fieldName',
        guestEmail: 'errors.fieldEmail',
      },
    })
    const described = describeBookingFailure(caught, timeZone)
    setFailure({ failure: described, slot: attempt.slot, serviceId: attempt.serviceId, unmatched })

    if (described.recover === 'slot') {
      // Back to the picker: clear the slot, and open the week the server named
      // when it named one. The availability cache was already invalidated by the
      // mutation, so what redraws is what is free now.
      setParams({ slot: undefined, date: described.goToDate ?? params.date })
      return
    }
    if (described.recover === 'service') {
      // The catalogue changed underneath. Everything downstream of the service
      // is now meaningless, including the week.
      setParams({ serviceId: undefined, staff: undefined, date: undefined, slot: undefined })
    }
  }

  /**
   * Whether the failure still describes the situation on screen.
   *
   * It survives being sent back a step — that is the point of it — and stops the
   * moment the customer has chosen a *different* one of the things it blamed.
   * Comparing against the choices it happened on is what expresses that without
   * a second piece of state to keep in step.
   *
   * Both choices, not just the slot. `SERVICE_INACTIVE` and
   * `STAFF_NOT_ASSIGNED` recover by clearing the service *and* the slot, so a
   * slot-only rule can never see the recovery it asked for: the customer picks
   * another service, `slot` is still absent, and "that service is no longer
   * bookable" stays pinned above the staff step and the picker for a service it
   * was never about. Absent still counts as unchanged, which is what keeps the
   * sentence on screen for the step it sent them back to.
   */
  const visibleFailure =
    failure &&
    (!params.serviceId || params.serviceId === failure.serviceId) &&
    (!params.slot || params.slot === failure.slot)
      ? failure
      : undefined

  return { visibleFailure, report, clear: () => setFailure(null) }
}
