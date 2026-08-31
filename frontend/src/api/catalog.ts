import { client } from '@/api/client'
import {
  serviceSchema,
  servicePageSchema,
  type Service,
  type ServicePage,
  type ServiceRequest,
  type ServiceUpdateRequest,
} from '@/api/schemas/catalog'

/**
 * `/api/services` — the four calls screen 7 is built on.
 *
 * Two facts about this endpoint shape the whole screen, and both are stated here
 * rather than rediscovered in a component:
 *
 * **`bookable` is not `active`.** The server computes it as *active **and** at
 * least one **active** staff member assigned* (`CatalogAdminService.toResponse`).
 * A service can be switched on, priced, buffered and still produce no slots
 * because nobody performs it — and the public page says nothing about it, it
 * simply lists the service and offers no times. The flag is the API answering
 * that question already; the screen's job is to stop it being a mystery.
 *
 * **`DELETE` deactivates.** It answers `200` with the updated `ServiceResponse`
 * carrying `active: false`, not `204`, and there is no hard delete on offer:
 * bookings reference services forever (`NO ACTION` on the FK, backend D15). So
 * the button says *Deactivate*, the archive is `?active=false`, and the response
 * is parsed and written into the cache like any other update.
 */

/** Exported so `api/reference.ts` reads the catalogue from the same string. */
export const SERVICES_PATH = '/api/services'

/**
 * The list's parameters. `active` is a tri-state: `true`, `false`, or absent for
 * everything — and absent is the third *tab*, not the default.
 *
 * **No `sort`.** The endpoint orders by name server-side and its own
 * `@Operation` says `?sort=` is not honoured, so a sort control here would be a
 * control that does nothing. That is a plan instruction and it is also the
 * reason `Pageable`'s usual third parameter is missing from this type.
 */
export type ServiceQuery = {
  active?: boolean
  page?: number
  size?: number
}

/**
 * Hierarchical, and deliberately **not** `referenceKeys.services`.
 *
 * The two caches hold the same resource under different questions. `useLookups`
 * wants every service that has ever existed, unfiltered and unpaged, so a
 * booking from March can be named; this screen wants one filtered page in a
 * stable order. Sharing a key would mean either the lookups paging or the
 * screen's tabs refetching the whole archive, and every mutation invalidates
 * both anyway — which is the line that keeps them honest with each other.
 */
export const serviceKeys = {
  all: ['services'] as const,
  lists: () => ['services', 'list'] as const,
  list: (query: ServiceQuery) => ['services', 'list', query] as const,
}

/** One page of the catalogue, exactly as asked for. */
export async function fetchServicePage(
  query: ServiceQuery,
  signal?: AbortSignal,
): Promise<ServicePage> {
  // Axios drops `undefined` params, which is what turns the All tab into an
  // omitted `?active=` rather than the string `"undefined"`.
  const response = await client.get(SERVICES_PATH, { params: query, signal })
  return servicePageSchema.parse(response.data)
}

/**
 * `POST /api/services` → `201` with the service.
 *
 * `staffIds` may be omitted, and the endpoint documents what that produces:
 * `bookable: false`. Screen 7 lets it happen — refusing to save would be a
 * client-side rule the API does not have — and warns first.
 */
export async function createService(request: ServiceRequest): Promise<Service> {
  const response = await client.post(SERVICES_PATH, request)
  return serviceSchema.parse(response.data)
}

/**
 * `PATCH /api/services/{id}` → the updated service.
 *
 * The request must already be a *patch*: keys the owner did not change are
 * absent, not empty strings and never `null`. `features/services/service-form.ts`
 * is where that stripping happens, once, so this function does not have to
 * guess which of its caller's blanks were deliberate.
 */
export async function updateService(id: string, request: ServiceUpdateRequest): Promise<Service> {
  const response = await client.patch(`${SERVICES_PATH}/${encodeURIComponent(id)}`, request)
  return serviceSchema.parse(response.data)
}

/**
 * `DELETE /api/services/{id}` → `200` with `active: false`.
 *
 * Named for what it does rather than for its verb. Nothing in this app calls it
 * "delete", including the variable it is assigned to, because a reader who sees
 * `deleteService` in a component will eventually write a confirmation dialog
 * that says the wrong thing about it.
 */
export async function deactivateService(id: string): Promise<Service> {
  const response = await client.delete(`${SERVICES_PATH}/${encodeURIComponent(id)}`)
  return serviceSchema.parse(response.data)
}

/**
 * `PATCH` with `active: true` — the archive tab's Reactivate.
 *
 * A named function rather than a `updateService(id, { active: true })` at the
 * call site, so that the pair *deactivate / reactivate* reads as a pair and so
 * that the one-field patch cannot accidentally acquire a second field.
 */
export async function reactivateService(id: string): Promise<Service> {
  return updateService(id, { active: true })
}
