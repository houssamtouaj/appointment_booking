import {
  authResponseSchema,
  businessSummarySchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  meResponseSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
} from '@/api/schemas/auth'
import {
  bookingRequestSchema,
  guestContactSchema,
  publicBookingSchema,
} from '@/api/schemas/booking'
import { acceptInvitationRequestSchema, invitationPreviewSchema } from '@/api/schemas/invitation'
import {
  openingHoursSchema,
  publicBusinessSchema,
  publicServiceSchema,
  publicStaffSchema,
  slotSchema,
} from '@/api/schemas/public'

/**
 * Which Zod object claims to describe which `components.schemas` entry.
 *
 * This exists for `scripts/contract-check.mjs` and for nothing else. Wave 2
 * chose to hand-write the contract (F3, and see `schemas/common.ts` for the
 * `currency` field that forced it), and the honest cost of that choice is that
 * the schemas can drift from the API without anything failing. The script closes
 * it by diffing property names against the running document; this map is what
 * tells the script which pairs to compare.
 *
 * **A schema not listed here is not checked.** Adding a resource in a later wave
 * means adding its line here in the same commit, which is the one convention
 * that keeps the script's green from being a statement about four files while
 * forty exist.
 *
 * **The error contract is absent, and cannot be added.** Neither `ProblemDetail`
 * nor `ValidationError` appears in `components.schemas` at all — verified, not
 * assumed: the published document has 42 schemas and not one of them mentions
 * either name. springdoc emits a component only for a type some handler
 * *returns*, and every error in this API leaves as a `ProblemDetail` built by
 * `Problems.of`, whose `code`, `errors` and `requestId` are attached through
 * `setProperty` at runtime where reflection cannot see them. Listing either here
 * would report a permanent phantom failure, and a check that is always red is a
 * check nobody reads.
 *
 * What guards that half of the contract instead is `src/api/error.test.ts`,
 * which parses a 422 body copied from what the API actually sends.
 */
/**
 * What the script needs and no more. The registry is heterogeneous by
 * definition — every value is a different `ZodObject` shape — and typing it as
 * `ZodObject<SomeUnion>` would mean naming all of them and rewriting the union
 * on every wave. `contract:check` reads the keys of `.shape` and nothing else,
 * so that is what the type says.
 */
type ContractSchema = { readonly shape: Readonly<Record<string, unknown>> }

export const CONTRACT_SCHEMAS: Record<string, ContractSchema> = {
  // --- Auth (wave 2) ---------------------------------------------------
  AuthResponse: authResponseSchema,
  MeResponse: meResponseSchema,
  BusinessSummary: businessSummarySchema,
  LoginRequest: loginRequestSchema,
  RegisterRequest: registerRequestSchema,
  ForgotPasswordRequest: forgotPasswordRequestSchema,
  ResetPasswordRequest: resetPasswordRequestSchema,

  // --- Invitations (wave 2) --------------------------------------------
  InvitationPreviewResponse: invitationPreviewSchema,
  AcceptInvitationRequest: acceptInvitationRequestSchema,

  // --- Public booking (wave 3) -----------------------------------------
  // `OpeningHours` is the one entry here whose component name is not
  // `*Response`: it is a JPA embeddable the API returns directly rather than a
  // response record, so springdoc names it after the entity.
  PublicBusinessResponse: publicBusinessSchema,
  PublicServiceResponse: publicServiceSchema,
  PublicStaffResponse: publicStaffSchema,
  OpeningHours: openingHoursSchema,
  SlotResponse: slotSchema,

  // --- Booking (wave 4) ------------------------------------------------
  // `PublicBookingResponse` is the one shape three endpoints answer with —
  // the 201, the manage page and a successful cancel — so one entry here
  // covers all three.
  PublicBookingResponse: publicBookingSchema,
  GuestContactResponse: guestContactSchema,
  BookingRequest: bookingRequestSchema,
}
