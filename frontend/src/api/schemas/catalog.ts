import { z } from 'zod'

import { uuid } from '@/api/schemas/common'
import { pageResponse } from '@/api/schemas/page'

/**
 * `ServiceResponse` — the catalogue as the *admin* sees it, which is a different
 * record from the `PublicServiceResponse` in `schemas/public.ts` and
 * deliberately so: buffers are internal scheduling, and `active` and `bookable`
 * are questions a customer never asks.
 *
 * Wave 5 reads this for one reason only — turning a booking's `serviceId` into a
 * name (F7). Wave 7 edits it. The whole shape is declared now rather than the
 * two fields the dashboard uses, because a partial schema is a contract that
 * `contract:check` cannot check.
 */
export const serviceSchema = z.object({
  id: uuid,
  name: z.string(),
  /**
   * Nullable column, and the API omits nulls rather than sending them — the same
   * rule `schemas/public.ts` states at length. Absent, never `null`.
   */
  description: z.string().optional(),
  durationMinutes: z.number().int().positive(),
  priceCents: z.number().int().nonnegative(),
  bufferBeforeMinutes: z.number().int().nonnegative(),
  bufferAfterMinutes: z.number().int().nonnegative(),
  /**
   * What one appointment costs the calendar, buffers included. Read off the
   * server rather than added up here, so the number on screen is the number the
   * availability engine and the database's exclusion constraint use (backend D4).
   */
  totalBlockMinutes: z.number().int().positive(),
  active: z.boolean(),
  /**
   * False when the service is inactive, when nobody is assigned, and when
   * everybody assigned has been deactivated. All three produce exactly no
   * availability, which is the support thread the flag exists to prevent.
   */
  bookable: z.boolean(),
  staffIds: z.array(uuid),
})

export type Service = z.infer<typeof serviceSchema>

/** `PageResponseServiceResponse`. The name springdoc publishes; see `page.ts`. */
export const servicePageSchema = pageResponse(serviceSchema)

export type ServicePage = z.infer<typeof servicePageSchema>
