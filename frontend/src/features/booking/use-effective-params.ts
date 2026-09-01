import {
  ANYONE,
  stepOf,
  useBookingParams,
  type BookingParams,
  type BookingStep,
} from '@/features/booking/booking-params'
import { useStaffForService } from '@/features/booking/public-queries'
import type { PublicBusiness, PublicService, PublicStaff } from '@/types'

export type EffectiveBookingParams = {
  /** The raw URL parameters, and the setter for them. */
  params: BookingParams
  setParams: (next: Partial<BookingParams>, options?: { replace?: boolean }) => void
  /** The service the URL names, if the catalogue still has it. */
  service: PublicService | undefined
  /** The one candidate, when there is only one — the case step 2 answers itself in. */
  onlyStaff: PublicStaff | undefined
  /**
   * The choices the URL is **allowed** to claim. Everything on screen reads
   * these rather than the raw parameters, so the stepper, the heading and the
   * step being rendered cannot disagree about which choices are still real.
   */
  effective: BookingParams
  effectiveStep: BookingStep
  /** Who the stepper names for step 2, which is not always the id in the URL. */
  staffSummary: string | undefined
  /** True when one candidate made step 2 unanswerable, so it is not a step to go back to. */
  answeredItself: boolean
}

/**
 * Reconciling a pasted URL against data that has moved on.
 *
 * A link outlives the things it names. `?service=` can point at a service that
 * has since been archived, or at nothing at all; `?staff=` can name somebody who
 * has left or stopped performing that service. Either one, taken at face value,
 * produces a step headed by a subject the app does not have — or an id that goes
 * into the availability request and comes back as an error screen with no way to
 * understand it.
 *
 * The answer in both cases is to drop back to the last step the customer can
 * answer, and the mechanism is this one derived object rather than a redirect: no
 * effect, no navigation, nothing to race. It was inline in `booking-flow-page`,
 * where it was the first of three responsibilities in one 380-line component.
 *
 * **Not a staleness check standing in for the server's.** Whether a service is
 * still bookable is answered by `422 SERVICE_INACTIVE` at booking time and by
 * nothing here.
 */
export function useEffectiveBookingParams(
  slug: string,
  business: PublicBusiness,
): EffectiveBookingParams {
  const { params, setParams } = useBookingParams()

  const service = business.services.find((candidate) => candidate.id === params.serviceId)

  const { data: staffList } = useStaffForService(slug, service?.id)
  const onlyStaff = staffList?.length === 1 ? staffList[0] : undefined

  /**
   * Only once the list has arrived. `staffList` is `undefined` while it loads,
   * and bouncing on that would send every direct link through the staff step for
   * a moment on its way in.
   */
  const staffKnown =
    params.staff === ANYONE || !staffList || staffList.some((member) => member.id === params.staff)

  const effective: BookingParams = !service
    ? {}
    : staffKnown
      ? params
      : { serviceId: params.serviceId }

  const staffSummary =
    effective.staff === ANYONE
      ? // When one person is the only candidate the step answered itself, so the
        // stepper names them rather than saying "Anyone" — which would read as a
        // choice the customer did not make.
        (onlyStaff?.displayName ?? 'Anyone')
      : staffList?.find((member) => member.id === effective.staff)?.displayName

  return {
    params,
    setParams,
    service,
    onlyStaff,
    effective,
    effectiveStep: stepOf(effective),
    staffSummary,
    // `StaffStep` redirects out of it on mount, so a link back there would do
    // nothing visible.
    answeredItself: Boolean(onlyStaff) && effective.staff === ANYONE,
  }
}
