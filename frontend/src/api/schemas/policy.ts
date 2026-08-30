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
