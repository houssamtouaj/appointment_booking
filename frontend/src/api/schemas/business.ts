import { z } from 'zod'

import { currencyCode, uuid, zoneId } from '@/api/schemas/common'

/**
 * `GET`/`PUT /api/business` — the tenant's own settings.
 *
 * Related to but not the same as `BusinessSummary` in `schemas/auth.ts`, which
 * is the five fields ridden along on every `MeResponse`. This one adds the
 * deposit rule, which no other screen needs and the settings form owns.
 */

/**
 * The settings as the form reads them back.
 *
 * **`depositRequired` here is the stored flag, not the effective answer.** A
 * checkbox left ticked with a percentage of zero comes back exactly that way,
 * because a form has to show what it saved. The public page reports
 * `depositRequired: false` for the same row — `Business.requiresDeposit()` ANDs
 * the two — and the two views disagreeing on purpose is why they are two
 * records. The form says so in words rather than quietly normalising either.
 */
export const businessSchema = z.object({
  id: uuid,
  /**
   * Read-only, and absent from the request: the public URL segment is immutable.
   * A booking page whose address changes breaks every link the business has ever
   * sent a customer, and there is no redirect to soften it. `Business` has no
   * setter for it either.
   */
  slug: z.string(),
  name: z.string(),
  timezone: zoneId,
  currency: currencyCode,
  depositRequired: z.boolean(),
  depositPercent: z.number().int().min(0).max(100),
})

export type Business = z.infer<typeof businessSchema>

/**
 * `PUT /api/business`. Every field is required except the last, which is a
 * conversation rather than a value.
 *
 * **`confirmShift` is never sent on a first attempt.** Changing the timezone
 * moves every future slot the engine will compute — working hours are wall-clock
 * times read in this zone — so the API answers the first try with
 * `409 TIMEZONE_SHIFT_UNCONFIRMED`, carrying `currentTimezone`,
 * `requestedTimezone` and `affectedBookings`, and only a resubmission with the
 * flag goes through. The 409 *is* the prompt: pre-empting it would remove the
 * one warning an owner gets, which is why `features/settings` builds the request
 * without the field and adds it only from the dialog's confirm button. There is
 * a test asserting exactly that.
 *
 * The flag is ignored on every other kind of update, so a save that does not
 * move the zone never sees any of this.
 */
/*
 * No messages on this schema, deliberately. It shapes the *request*, and the
 * form that builds one carries its own resolver with its own key-based messages
 * (`features/settings/business-form.tsx`). A sentence here could never reach a
 * field and would only be an English string waiting for somebody to wire it to
 * one; Zod's own text is the right level for a contract violation.
 */
export const businessRequestSchema = z.object({
  name: z.string().min(1).max(120),
  /**
   * An IANA region id. Deliberately not checked against a list here: the
   * browser's tz database and the server's can differ by a release, and the
   * server validates it properly — "well-formed but unknown" is not something a
   * regex can decide. The form offers the browser's zones as suggestions and
   * accepts anything, which is the same trade `zoneId` makes on the way in.
   */
  timezone: z.string().min(1).max(64),
  /**
   * ISO 4217, three letters, upper-cased before it is sent. It is the unit of
   * every `priceCents` in the tenant and **changing it converts nothing** — the
   * form has to say that, because a catalogue silently reinterpreted from EUR to
   * JPY is a hundredfold price change nobody asked for.
   */
  currency: currencyCode,
  depositRequired: z.boolean(),
  /**
   * 0–100. **Zero means no deposit whatever the checkbox says**, which is what
   * `Business.requiresDeposit()` computes and what the public page reports.
   */
  depositPercent: z.number().int().min(0).max(100),
  confirmShift: z.boolean().optional(),
})

export type BusinessRequest = z.infer<typeof businessRequestSchema>
