import { z } from 'zod'

import { isoInstant } from '@/api/schemas/common'

/**
 * `PolicyResponse` — the booking rules, and the one number the calendar draws
 * with.
 *
 * **Readable by staff, not only by owners.** `GET /api/policy` carries no
 * `@PreAuthorize`; only the `PUT` beside it does, and the backend says why in as
 * many words: a staff member's calendar is drawn in the business timezone and
 * their bookings are governed by the cutoff, so hiding the numbers would leave
 * them unable to explain their own screen. That is what makes it safe for the
 * calendar to depend on this — a `STAFF` session gets the same 200.
 *
 * No business id on the wire: there is exactly one policy per tenant and the
 * tenant comes from the token, so an id would be a value the client could only
 * echo back.
 */
export const policySchema = z.object({
  minLeadTimeHours: z.number().int().nonnegative(),
  maxAdvanceDays: z.number().int().nonnegative(),
  cancellationCutoffHours: z.number().int().nonnegative(),
  /**
   * One of 5, 10, 15, 20, 30 or 60 — 15 on the demo. The calendar's row pitch,
   * and the reason this endpoint is a dependency of a screen that is otherwise
   * about bookings.
   *
   * Deliberately **not** constrained to that set here. The backend validates it
   * on the way in, so a value outside it means the server has changed its mind
   * and the honest response is to draw the rows it asks for rather than to blank
   * the calendar over a number that is merely unfamiliar. {@link GRID_FALLBACK_MINUTES}
   * covers the case where the request fails outright.
   */
  slotGranularityMinutes: z.number().int().positive(),
  updatedAt: isoInstant,
})

export type Policy = z.infer<typeof policySchema>

/**
 * The row pitch to draw when the policy cannot be read at all.
 *
 * Fifteen minutes, which is the demo's value and the commonest one — but the
 * number matters much less than the decision it encodes: **a failed policy
 * fetch must not black out the calendar.** Row lines are the ruling on the
 * paper. Bookings are positioned by minutes against the day's real length and
 * do not consult this at all, so a wrong pitch draws the grid slightly wrong
 * and every appointment on it exactly right.
 */
export const GRID_FALLBACK_MINUTES = 15

/**
 * The six values `@SlotGranularity` accepts, and the only six a select may
 * offer.
 *
 * A closed enum on the wire, unlike the response's reading of the same number.
 * The asymmetry is deliberate and both halves are right: a *response* carrying a
 * seventh value means the server has changed its mind and the honest answer is
 * to draw the rows it asks for, while a *request* carrying one is a 422 on every
 * value that is not here. So the response stays a plain positive integer
 * ({@link policySchema}) and the request is this list — which is also what stops
 * the form being a number input, because a free number input produces a refusal
 * on almost everything a person can type into it.
 */
export const SLOT_GRANULARITIES = [5, 10, 15, 20, 30, 60] as const

export type SlotGranularity = (typeof SLOT_GRANULARITIES)[number]

/**
 * `PUT /api/policy` — a full replace, like the endpoint it posts to.
 *
 * A replace rather than a patch because the four numbers are read together on
 * every availability request and edited together on one form: there is no screen
 * that changes the lead time without the operator seeing the cutoff next to it.
 *
 * Every bound below is the server's, restated so a person is told which field
 * they got wrong before the round trip rather than after it. Where the two could
 * ever disagree the server is right and this is the affordance — the rule the
 * whole app follows (overview rule 1).
 */
/* No messages here, for the reason `schemas/business.ts` records: `PolicyForm`
 * has its own resolver and its own keys, so a sentence on this schema could
 * never reach a field. */
export const policyRequestSchema = z.object({
  /** `@Min(0) @Max(168)`. Zero is legal and means "up to the last minute". */
  minLeadTimeHours: z.number().int().min(0).max(168),
  /** `@Min(1) @Max(365)`. A calendar open for no days at all is not offered. */
  maxAdvanceDays: z.number().int().min(1).max(365),
  /** `@Min(0) @Max(168)`. Staff ignore it; only a customer's own cancel obeys it. */
  cancellationCutoffHours: z.number().int().min(0).max(168),
  slotGranularityMinutes: z.literal(SLOT_GRANULARITIES),
})

export type PolicyRequest = z.infer<typeof policyRequestSchema>
