import { z } from 'zod'

import { currencyCode, uuid, zoneId } from '@/api/schemas/common'
import type { TKey } from '@/i18n'

/**
 * `/api/auth/*`, and the two shapes every later wave inherits: `BusinessSummary`
 * is the tenant header on every admin screen, and `MeResponse` decides what the
 * nav renders.
 *
 * The response half mirrors the backend records exactly, because
 * `contract:check` diffs it against `/v3/api-docs` and any liberty taken here
 * shows up as a failure there. The request half is looser on purpose — it is
 * also the React Hook Form resolver, so it carries messages a person reads.
 */

/** `com.slotflow.staff.Role`. */
export const roleSchema = z.enum(['OWNER', 'STAFF'])

export type Role = z.infer<typeof roleSchema>

/**
 * The tenant, as much of it as a session needs to render a shell.
 *
 * `currency` is a three-letter string despite the OpenAPI document typing it
 * `object` — see `schemas/common.ts` for why that one field is the argument for
 * hand-writing all of these.
 */
export const businessSummarySchema = z.object({
  id: uuid,
  slug: z.string(),
  name: z.string(),
  timezone: zoneId,
  currency: currencyCode,
})

export type BusinessSummary = z.infer<typeof businessSummarySchema>

/** `GET /api/auth/me`, and the `user` member of every `AuthResponse`. */
export const meResponseSchema = z.object({
  id: uuid,
  email: z.email(),
  fullName: z.string(),
  role: roleSchema,
  business: businessSummarySchema,
})

export type MeResponse = z.infer<typeof meResponseSchema>

/**
 * What login, register, demo-login and refresh all return.
 *
 * There is no refresh token here and there must never be one: it leaves in an
 * httpOnly cookie (`RefreshTokenCookie`), and a field for it in this schema is
 * the first step of the mistake that ends with a seven-day credential in
 * `localStorage`.
 *
 * `expiresIn` is seconds rather than an instant because the client's clock may
 * be wrong, and a countdown is what a pre-emptive refresh would schedule from.
 */
export const authResponseSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.string(),
  expiresIn: z.number(),
  user: meResponseSchema,
})

export type AuthResponse = z.infer<typeof authResponseSchema>

// ---------------------------------------------------------------------------
//  Requests — these are also the form resolvers, so the messages are read
// ---------------------------------------------------------------------------

/**
 * `com.slotflow.security.Passwords`: at least 8 characters, at most 72 *bytes*.
 *
 * Bytes and not characters, which is not pedantry — BCrypt reads the first 72
 * bytes and the backend rejects anything longer rather than truncating, so 72
 * characters of Cyrillic is a 422 from a form that believed it was fine.
 * Checking it here puts the message under the field instead of after a round
 * trip.
 *
 * The messages are **dictionary keys, not sentences**, and so is every message
 * below. This module is evaluated once, so a sentence here would be captured in
 * whatever language the tab was loaded in and would survive a language switch
 * unchanged — the trap `features/services/service-form.ts` describes at length.
 * The key travels through react-hook-form's `message`, which is typed `string`,
 * and the screen turns it back into prose with `t(... as TKey)` at the field.
 */
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_MAX_BYTES = 72

const utf8 = new TextEncoder()

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, 'auth.password.tooShort' satisfies TKey)
  .refine(
    (value) => utf8.encode(value).length <= PASSWORD_MAX_BYTES,
    'auth.password.tooLong' satisfies TKey,
  )

/**
 * Deliberately not `z.email()`, and deliberately no length rule on the password.
 * `LoginRequest` has the same omissions for the same reason: a sign-in form that
 * says "that is not a password we would have accepted" is an account-enumeration
 * oracle, just a quiet one.
 */
export const loginRequestSchema = z.object({
  email: z
    .string()
    .min(1, 'auth.login.emailRequired' satisfies TKey)
    .max(320),
  password: z
    .string()
    .min(1, 'auth.login.passwordRequired' satisfies TKey)
    .max(200),
})

export type LoginRequest = z.infer<typeof loginRequestSchema>

/** `RegisterRequest` — one call creates the business, its policy and its owner. */
export const registerRequestSchema = z.object({
  businessName: z
    .string()
    .min(1, 'errors.fieldBusinessName' satisfies TKey)
    .max(120),
  slug: z
    .string()
    .min(1, 'auth.register.slugRequired' satisfies TKey)
    // Case-insensitive, matching the backend: `Business` lower-cases before it
    // checks its own regex, so "Dana-Clinic" is a usable answer rather than an
    // error a person has to decode.
    .regex(/^[A-Za-z0-9-]{3,40}$/, 'errors.fieldSlug' satisfies TKey),
  timezone: zoneId.max(64),
  currency: z.string().regex(/^[A-Za-z]{3}$/, 'auth.register.currencyShape' satisfies TKey),
  fullName: z
    .string()
    .min(1, 'errors.fieldName' satisfies TKey)
    .max(120),
  email: z.email('errors.fieldEmail' satisfies TKey).max(320),
  password: passwordSchema,
})

export type RegisterRequest = z.infer<typeof registerRequestSchema>

/** `ForgotPasswordRequest`. Answered 202 whether or not the address exists (D6). */
export const forgotPasswordRequestSchema = z.object({
  email: z.email('errors.fieldEmail' satisfies TKey).max(320),
})

export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>

/** `ResetPasswordRequest`. The token comes from the route, not from an input. */
export const resetPasswordRequestSchema = z.object({
  token: z.string().min(1).max(200),
  password: passwordSchema,
})

export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>
