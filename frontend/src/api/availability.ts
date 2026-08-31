import { client } from '@/api/client'
import {
  overrideListSchema,
  overrideSchema,
  workingHoursSchema,
  type Override,
  type OverrideRequest,
  type WorkingHours,
  type WorkingHoursRequest,
} from '@/api/schemas/availability'

/**
 * Everything the availability engine reads, as functions: the weekly template
 * and the one-off overrides.
 *
 * Two path families, and the split is the authorisation model rather than a
 * naming choice. A staff member may write their own hours and their own
 * overrides; only an owner may write anybody else's or close the whole business.
 * The first of those rules depends on the id in the path, so the server enforces
 * it in `WorkingHoursService`/`OverrideService` rather than with an annotation —
 * which is why `/team/:id/hours` is reachable by a `STAFF` session for
 * `:id === me.id` and by nobody else.
 */

const EXCEPTIONS_PATH = '/api/exceptions'

function staffPath(staffId: string): string {
  return `/api/staff/${encodeURIComponent(staffId)}`
}

/**
 * Flat, like `referenceKeys` and `policyKeys`. Every call is scoped to the
 * tenant in the token and there is no way to ask for another, so a business id
 * in the key would be decoration.
 *
 * `overrides` is keyed by the range because the month view refetches when the
 * range moves and both months should stay cached while somebody pages between
 * them; `hours` is keyed by the staff member for the same reason an owner
 * flipping between two colleagues should not refetch the first one.
 */
export const availabilityKeys = {
  all: ['availability'] as const,
  hours: (staffId: string) => ['availability', 'hours', staffId] as const,
  overrides: (range: { from: string; to: string }) =>
    ['availability', 'overrides', range.from, range.to] as const,
}

// ---------------------------------------------------------------------------
//  Working hours
// ---------------------------------------------------------------------------

export async function fetchWorkingHours(
  staffId: string,
  signal?: AbortSignal,
): Promise<WorkingHours> {
  const response = await client.get(`${staffPath(staffId)}/working-hours`, { signal })
  return workingHoursSchema.parse(response.data)
}

/**
 * `PUT /api/staff/{staffId}/working-hours` — **a replace, not a patch.**
 *
 * Worth stating at the call site and not only in the schema, because the failure
 * mode is silent: a body that omits a previously-saved day deletes it, the
 * request succeeds, and the loss is discovered a week later as "my Saturday
 * disappeared". Every caller here sends the whole grid, and the screen says so
 * before the button is pressed.
 *
 * An identical body is a no-op server-side — `WorkingHoursService` compares the
 * week as a set before touching the table — so a save of an unchanged grid costs
 * a round trip and changes no ids.
 *
 * `422 HOURS_OVERLAP` is the one rule worth knowing here. The client checks for
 * overlap too, but that is an affordance: the server's answer is the rule, and
 * `features/hours` handles the refusal even on a body its own check passed.
 */
export async function replaceWorkingHours(
  staffId: string,
  request: WorkingHoursRequest,
): Promise<WorkingHours> {
  const response = await client.put(`${staffPath(staffId)}/working-hours`, request)
  return workingHoursSchema.parse(response.data)
}

// ---------------------------------------------------------------------------
//  Overrides — `exceptions` on the wire
// ---------------------------------------------------------------------------

/**
 * `GET /api/exceptions?from=&to=` — both levels in one list.
 *
 * **Both parameters are required**, and a request that omits either is a 400
 * rather than an unbounded read. The range is inclusive at both ends and there
 * is no cap on its span: overrides are one row per holiday per person and do not
 * grow with traffic, so the server deliberately declines to clamp it.
 *
 * Readable by staff as well as owners. A staff member has to be able to see the
 * business-wide closure that is about to empty their Tuesday.
 */
export async function fetchOverrides(
  range: { from: string; to: string },
  signal?: AbortSignal,
): Promise<Override[]> {
  const response = await client.get(EXCEPTIONS_PATH, { params: range, signal })
  return overrideListSchema.parse(response.data)
}

/** `POST /api/staff/{staffId}/exceptions` → `201`. Owner for anybody, staff for themselves. */
export async function createStaffOverride(
  staffId: string,
  request: OverrideRequest,
): Promise<Override> {
  const response = await client.post(`${staffPath(staffId)}/exceptions`, request)
  return overrideSchema.parse(response.data)
}

/**
 * `POST /api/exceptions` → `201`. **Owner only, and `BLOCKED` only.**
 *
 * A business may declare itself shut on behalf of its staff — that is what a
 * public holiday is — but it may not declare them available: only the person
 * working an evening knows whether they can. So the `EXTRA` direction stays
 * per-person and the form does not offer it here.
 *
 * One row with `staff_id NULL` (backend D5), applying to everybody now and to
 * whoever joins later — rather than N inserts that drift as the team changes.
 */
export async function createBusinessClosure(request: OverrideRequest): Promise<Override> {
  const response = await client.post(EXCEPTIONS_PATH, request)
  return overrideSchema.parse(response.data)
}

/**
 * `DELETE /api/staff/{staffId}/exceptions/{id}` → `204`.
 *
 * The staff id is checked against the row server-side rather than trusted, so
 * this cannot reach a colleague's day off — or a business-wide closure, which
 * belongs to nobody and is removed through {@link deleteOverride}.
 */
export async function deleteStaffOverride(staffId: string, id: string): Promise<void> {
  await client.delete(`${staffPath(staffId)}/exceptions/${encodeURIComponent(id)}`)
}

/**
 * `DELETE /api/exceptions/{id}` → `204`. **Owner only**, and broader than its
 * sibling on purpose: it is the delete button on the merged list, where an owner
 * sees closures and individuals' days off side by side and should not need a
 * different endpoint depending on which row they clicked.
 */
export async function deleteOverride(id: string): Promise<void> {
  await client.delete(`${EXCEPTIONS_PATH}/${encodeURIComponent(id)}`)
}
