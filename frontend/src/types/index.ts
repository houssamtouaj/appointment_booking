/**
 * The application's types, all of them `z.infer` of a schema in
 * `src/api/schemas/` (F4).
 *
 * Nothing here is hand-written, and that is the whole point: a type and a
 * validator that are declared separately are two descriptions of one thing, and
 * they agree only until somebody is in a hurry. Deriving one from the other
 * makes disagreement impossible, and `contract:check` then compares that single
 * description against what the API actually publishes.
 *
 * Screens import from here. `@/api/schemas` is for code that needs the runtime
 * schema object itself.
 */
export type {
  AuthResponse,
  BusinessSummary,
  ForgotPasswordRequest,
  LoginRequest,
  MeResponse,
  RegisterRequest,
  ResetPasswordRequest,
  Role,
} from '@/api/schemas/auth'

export type {
  Override,
  OverrideRequest,
  OverrideType,
  WorkingHours,
  WorkingHoursRange,
  WorkingHoursRequest,
} from '@/api/schemas/availability'

export type {
  BookingRequest,
  BookingStatus,
  GuestContact,
  GuestDetails,
  PublicBooking,
} from '@/api/schemas/booking'

export type {
  BookingDetail,
  BookingPage,
  BookingStatusRequest,
  StaffTransition,
} from '@/api/schemas/booking-admin'

export type { Business, BusinessRequest } from '@/api/schemas/business'

export type {
  Service,
  ServicePage,
  ServiceRequest,
  ServiceUpdateRequest,
} from '@/api/schemas/catalog'

export type { BookingSummary, DashboardStats } from '@/api/schemas/dashboard'

export type { AcceptInvitationRequest, InvitationPreview } from '@/api/schemas/invitation'

export type {
  DayOfWeek,
  OpeningHours,
  PublicBusiness,
  PublicService,
  PublicStaff,
  Slot,
} from '@/api/schemas/public'

export type { Policy, PolicyRequest, SlotGranularity } from '@/api/schemas/policy'

export type { ErrorCode, ProblemDetail, ValidationError } from '@/api/schemas/problem'

export type {
  DeactivationWarning,
  InviteStaffRequest,
  Staff,
  StaffUpdateResponse,
  UpdateStaffRequest,
} from '@/api/schemas/staff'
