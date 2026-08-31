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
  overrideRequestSchema,
  overrideSchema,
  workingHoursRangeSchema,
  workingHoursRequestSchema,
  workingHoursSchema,
} from '@/api/schemas/availability'
import {
  bookingRequestSchema,
  guestContactSchema,
  publicBookingSchema,
} from '@/api/schemas/booking'
import {
  bookingDetailSchema,
  bookingPageSchema,
  bookingStatusRequestSchema,
} from '@/api/schemas/booking-admin'
import { businessRequestSchema, businessSchema } from '@/api/schemas/business'
import {
  serviceRequestSchema,
  serviceSchema,
  servicePageSchema,
  serviceUpdateRequestSchema,
} from '@/api/schemas/catalog'
import { bookingSummarySchema, dashboardStatsSchema } from '@/api/schemas/dashboard'
import { acceptInvitationRequestSchema, invitationPreviewSchema } from '@/api/schemas/invitation'
import { policyRequestSchema, policySchema } from '@/api/schemas/policy'
import {
  deactivationWarningSchema,
  inviteStaffRequestSchema,
  staffSchema,
  staffUpdateResponseSchema,
  updateStaffRequestSchema,
} from '@/api/schemas/staff'
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

  // --- Reference data and the dashboard (wave 5) ------------------------
  // `PageResponse<T>` is generic, and springdoc names each instantiation after
  // its element type rather than emitting one component with a type parameter.
  // So the key here is `PageResponseServiceResponse`, and a second paged
  // resource in wave 6 gets its own entry rather than reusing this one.
  ServiceResponse: serviceSchema,
  PageResponseServiceResponse: servicePageSchema,
  StaffResponse: staffSchema,
  BookingSummaryResponse: bookingSummarySchema,
  DashboardStatsResponse: dashboardStatsSchema,

  // --- The calendar (wave 6) -------------------------------------------
  // The second paged resource, and it gets its own entry rather than reusing
  // the services one: springdoc names each instantiation of `PageResponse<T>`
  // after its element type, so these two are unrelated component names that
  // happen to share a shape.
  PageResponseBookingSummaryResponse: bookingPageSchema,
  BookingResponse: bookingDetailSchema,
  BookingStatusRequest: bookingStatusRequestSchema,
  PolicyResponse: policySchema,

  // --- Catalog and team writes (wave 7) --------------------------------
  // The first request bodies in the registry that are not auth's. Every one of
  // them is a *patch* except `ServiceRequest` and `InviteStaffRequest`, and the
  // check is still a name diff: what it catches is a field renamed on the
  // server, which on a patch body is worse than on a response — a request that
  // sends the old name is accepted, ignored, and answers 200 with the edit
  // silently not applied.
  ServiceRequest: serviceRequestSchema,
  ServiceUpdateRequest: serviceUpdateRequestSchema,
  InviteStaffRequest: inviteStaffRequestSchema,
  UpdateStaffRequest: updateStaffRequestSchema,
  StaffUpdateResponse: staffUpdateResponseSchema,
  // A record nested inside `StaffUpdateResponse`. springdoc's `TypeNameResolver`
  // publishes a nested class under its **simple** name unless `use-fqn` is set,
  // which this backend does not set — so `DeactivationWarning`, not
  // `StaffUpdateResponseDeactivationWarning`. That is the one key in this block
  // inferred from springdoc's behaviour rather than read off a controller, and
  // `npm run contract:check` against a running stack is what confirms it.
  DeactivationWarning: deactivationWarningSchema,

  // --- Availability configuration and settings (wave 8) -----------------
  // `WorkingHoursRange` is one component for two directions: the server uses
  // the same record in the request and the response, deliberately, because a
  // range has no server-side fields at all. So one key covers both, and a row
  // id appearing on it would be a contract change worth failing over.
  WorkingHoursRange: workingHoursRangeSchema,
  WorkingHoursResponse: workingHoursSchema,
  WorkingHoursRequest: workingHoursRequestSchema,
  // `exceptions` on the wire, `Override` in the code — the backend named the
  // class away from `AvailabilityException` (D8) and kept the path, so the
  // component names follow the class rather than the URL.
  OverrideResponse: overrideSchema,
  OverrideRequest: overrideRequestSchema,
  BusinessResponse: businessSchema,
  // The one request body in the registry with a field the response does not
  // have: `confirmShift`. The check is a name diff in both directions, so
  // dropping it server-side would surface here rather than as a timezone
  // change that silently stops asking.
  BusinessRequest: businessRequestSchema,
  PolicyRequest: policyRequestSchema,
}
