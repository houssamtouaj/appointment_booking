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
/**
 * The four numeric bounds the catalogue form enforces before it asks the server,
 * mirrored from `catalog/ServiceDuration.java` and the Bean Validation
 * annotations on `ServiceRequest`.
 *
 * Declared as constants rather than written into the Zod chain twice, because
 * they are also the `min`, `max` and `step` attributes on the number inputs and
 * the numbers the hint text quotes. Three copies of "480" is three places for a
 * backend change to go unnoticed.
 */
export const SERVICE_MIN_MINUTES = 5
export const SERVICE_MAX_MINUTES = 480
/** A duration must be a multiple of this. The same 5 as the minimum, on purpose. */
export const SERVICE_STEP_MINUTES = 5
/** Two hours either side is `@Max(120)` on both buffer fields. */
export const MAX_BUFFER_MINUTES = 120

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

/**
 * `ServiceRequest` — the create body, and **not** the shape of the form.
 *
 * The form's price field holds a decimal string in currency units, because
 * `lib/money.ts` exists so that no `double` is ever made out of a price; this
 * schema describes what leaves the browser, which is minor units. The
 * conversion between the two happens once, in
 * `features/services/service-form.ts`. So this is declared for the wire type and
 * for `contract:check`, and `zodResolver` never sees it.
 *
 * Every bound below is the backend's own, copied rather than invented, and each
 * one exists so a person is told before a round trip rather than after it. Rule
 * 1 still holds — the server validates all of it again and its 422 lands on the
 * field through `applyFieldErrors`.
 */
export const serviceRequestSchema = z.object({
  /** `@NotBlank @Size(min = 2, max = 120)`. */
  name: z.string().min(2).max(120),
  /** `@Size(max = 2000)`, and absent rather than `null` — see the response above. */
  description: z.string().max(2000).optional(),
  /** `@ServiceDuration`: 5 to 480 minutes, and a multiple of 5. */
  durationMinutes: z
    .number()
    .int()
    .min(SERVICE_MIN_MINUTES)
    .max(SERVICE_MAX_MINUTES)
    .refine((minutes) => minutes % SERVICE_STEP_MINUTES === 0),
  /** `@NotNull @PositiveOrZero`. Minor units of the **business's** currency. */
  priceCents: z.number().int().nonnegative(),
  /** `@Min(0) @Max(120)`. Omitted is 0 — `CatalogAdminService.orZero`. */
  bufferBeforeMinutes: z.number().int().min(0).max(MAX_BUFFER_MINUTES).optional(),
  bufferAfterMinutes: z.number().int().min(0).max(MAX_BUFFER_MINUTES).optional(),
  /**
   * Who performs it. `@Size(max = 100)`.
   *
   * Omitting it is legal and produces `bookable: false`, which the endpoint
   * documents and which screen 7 turns into a visible row state rather than a
   * silence. An id from another tenant is `422 STAFF_NOT_IN_BUSINESS`, carrying
   * the offending ids as a problem member.
   */
  staffIds: z.array(uuid).max(100).optional(),
})

export type ServiceRequest = z.infer<typeof serviceRequestSchema>

/**
 * `ServiceUpdateRequest` — a patch, and the difference from the create body is
 * not only that everything is optional.
 *
 * Three things about it are load-bearing, all three verified in
 * `CatalogAdminService.update`:
 *
 * - **Absent leaves a field alone; `null` is a 422.** Every field here is
 *   `.optional()` and none is `.nullable()`, and the builder that produces this
 *   object drops keys rather than setting them to `null`. React Hook Form hands
 *   back empty strings for untouched optional fields, and an empty string is not
 *   nothing — `description: ""` is a request to *clear* the description, which is
 *   a legitimate edit and a silent data loss if it is sent by accident.
 * - **`staffIds` replaces the whole assignment set**, and `[]` unassigns
 *   everyone. A form that posted only the newly ticked boxes would quietly
 *   unassign every colleague who was already there.
 * - **`active` is settable here and nowhere else.** `DELETE /api/services/{id}`
 *   only ever sets it false; reactivating an archived service is this endpoint
 *   with `active: true`.
 */
export const serviceUpdateRequestSchema = serviceRequestSchema.partial().extend({
  active: z.boolean().optional(),
})

export type ServiceUpdateRequest = z.infer<typeof serviceUpdateRequestSchema>
