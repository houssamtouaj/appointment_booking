import { z } from 'zod'

import { roleSchema } from '@/api/schemas/auth'
import { isoInstant, uuid } from '@/api/schemas/common'
import type { TKey } from '@/i18n'

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

/** `InviteStaffRequest` — the whole invitation, three fields. */
export const inviteStaffRequestSchema = z.object({
  /**
   * `@NotBlank @Email @Size(max = 320)`. Lower-cased and trimmed server-side
   * before the uniqueness check, so `Sam@Example.com` is a usable answer.
   *
   * An address that already has an account **anywhere in the product** is
   * `409 EMAIL_TAKEN`: one human cannot own two businesses in v1 (backend D13).
   * That is a sentence the screen has to write itself, because "conflict" tells
   * an owner nothing about what to do next.
   */
  // Keys, not sentences — this module is evaluated once, so a sentence would
  // freeze the language the tab was loaded in. `InviteDialog` resolves them.
  email: z.email('team.invite.emailShape' satisfies TKey).max(320),
  fullName: z
    .string()
    .min(1, 'team.invite.nameRequired' satisfies TKey)
    .max(120),
  /** `OWNER` or `STAFF`. There is no third role and no per-permission model. */
  role: roleSchema,
})

export type InviteStaffRequest = z.infer<typeof inviteStaffRequestSchema>

/**
 * `UpdateStaffRequest` — and note what is *not* on it: `serviceIds`.
 *
 * Service assignment is owned by the catalogue side only
 * (`ServiceRequest.staffIds`), so the team screen renders who performs what and
 * cannot edit it. That is the API's shape rather than a simplification here, and
 * it is why screen 8's rows link to the service rather than offering a picker.
 *
 * A patch, on the same terms as `serviceUpdateRequestSchema`: absent leaves a
 * field alone, `null` is a 422.
 *
 * Two of the three fields are privileged. An owner may set any of them on
 * anybody; a staff member may set `fullName` on **themselves** and nothing else,
 * and `role` or `active` from a staff session is a `403` from
 * `changesPrivilegedFields`. Screen 8 is owner-only, so that path is the
 * backend's third line of defence rather than a state this screen renders.
 */
export const updateStaffRequestSchema = z.object({
  fullName: z
    .string()
    .min(1, 'team.edit.nameRequired' satisfies TKey)
    .max(120)
    .optional(),
  role: roleSchema.optional(),
  /**
   * `false` deactivates: the person's refresh tokens are revoked, they lose the
   * ability to sign in, and **their appointments stay in the calendar**. `true`
   * reactivates, and is refused with `409 DATA_CONFLICT` for somebody who never
   * accepted their invitation — resend it instead.
   */
  active: z.boolean().optional(),
})

export type UpdateStaffRequest = z.infer<typeof updateStaffRequestSchema>

/**
 * `StaffUpdateResponse.DeactivationWarning` — the numbers behind screen 8's most
 * important sentence.
 *
 * Present **only** when a deactivation left appointments in the diary; a rename,
 * a role change and a reactivation all answer with `warning` absent. It is a
 * consequence rather than a failure, which is why it arrives on a `200` and not
 * as a `409` to be confirmed: the change has already happened, and what the
 * screen owes the owner is the truth about what it did.
 *
 * `nextBookingAt` is `upcoming.getFirst().getStartsAt()` and is never null when
 * the object is present, so it is required here.
 */
export const deactivationWarningSchema = z.object({
  /** `long` on the wire. The count of active bookings still ahead of now. */
  upcomingBookings: z.number().int().nonnegative(),
  nextBookingAt: isoInstant,
})

export type DeactivationWarning = z.infer<typeof deactivationWarningSchema>

/**
 * `StaffUpdateResponse` — `{ staff, warning? }`, the answer to every
 * `PATCH /api/staff/{id}`.
 *
 * `warning` is `.optional()` and not `.nullable()`: the API is configured
 * `NON_NULL` (`JacksonConfig`), so a null member is omitted from the body rather
 * than serialised as `null`. The same rule `description` follows on
 * `ServiceResponse`.
 */
export const staffUpdateResponseSchema = z.object({
  staff: staffSchema,
  warning: deactivationWarningSchema.optional(),
})

export type StaffUpdateResponse = z.infer<typeof staffUpdateResponseSchema>
