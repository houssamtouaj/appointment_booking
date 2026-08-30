import { z } from 'zod'

import { roleSchema } from '@/api/schemas/auth'
import { uuid } from '@/api/schemas/common'

/**
 * `StaffResponse` — a colleague as the admin screens see them, email address
 * included. That is correct rather than a leak: an owner invited that person and
 * needs to see who they invited. The public counterpart is
 * `PublicStaffResponse`, which carries an id and a display name and nothing else.
 *
 * `GET /api/staff` returns a **plain array**, not a page, and includes inactive
 * people. Both matter to F7: a booking from March may name somebody who has
 * since left, and a lookup that cannot resolve them renders a calendar of blanks.
 *
 * The three booleans answer one question between them — *what does the owner
 * click next?* `active: false` with `accepted: false` is an invitee, so the
 * answer is resend; `active: false` with `accepted: true` is somebody who was
 * deactivated, so the answer is reactivate. Wave 7 renders that; wave 5 only
 * needs `fullName`, and declares the rest so `contract:check` has something to
 * check.
 */
export const staffSchema = z.object({
  id: uuid,
  /** `z.email()`, matching `meResponseSchema` — the same column, one rule. */
  email: z.email(),
  fullName: z.string(),
  role: roleSchema,
  active: z.boolean(),
  /** This person has set a password at some point. Never the hash. */
  accepted: z.boolean(),
  /** An invitation is outstanding *now*: unused, and inside its seven days. */
  invitationPending: z.boolean(),
  serviceIds: z.array(uuid),
})

export type Staff = z.infer<typeof staffSchema>

export const staffListSchema = z.array(staffSchema)
