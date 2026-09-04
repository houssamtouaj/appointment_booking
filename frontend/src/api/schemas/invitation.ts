import { z } from 'zod'

import { passwordSchema } from '@/api/schemas/auth'
import type { TKey } from '@/i18n'

/**
 * `/api/public/invitations/{token}` — the only resource in this wave that is
 * neither `/api/auth` nor authenticated. The invitee has no account until the
 * accept call succeeds, so both endpoints are anonymous by necessity.
 */

/**
 * `com.slotflow.staff.InvitationPreviewResponse`. Two fields, and the reason
 * there are only two is that both are things the recipient of the email already
 * knows — which is what makes them safe to hand to a bare token.
 */
export const invitationPreviewSchema = z.object({
  businessName: z.string(),
  email: z.email(),
})

export type InvitationPreview = z.infer<typeof invitationPreviewSchema>

/** `AcceptInvitationRequest`. Same password rule as everywhere else. */
export const acceptInvitationRequestSchema = z.object({
  // A key, not a sentence — see `schemas/auth.ts`. `AcceptInvitationPage` resolves it.
  fullName: z
    .string()
    .min(1, 'errors.fieldName' satisfies TKey)
    .max(120),
  password: passwordSchema,
})

export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>
