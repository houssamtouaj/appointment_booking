import { SERVICES_PATH } from '@/api/catalog'
import { client } from '@/api/client'
import { servicePageSchema, type Service } from '@/api/schemas/catalog'
import { MAX_PAGE_SIZE } from '@/api/schemas/page'
import { staffListSchema, type Staff } from '@/api/schemas/staff'
import { STAFF_PATH } from '@/api/staff'

/**
 * The two reads that make every booking on every admin screen legible (F7).
 *
 * Every booking-shaped payload in this API carries `serviceId` and `staffId` and
 * no names — `BookingSummaryResponse` says so in as many words. The calendar,
 * the dashboard's `upcoming` and the bookings list all need the identical join,
 * so it is fetched once per session here and joined client-side in
 * `useLookups()`, rather than three times into three caches that drift apart.
 *
 * **Both are fetched unfiltered, and that is the load-bearing decision.** No
 * `?active=` on the services, and `GET /api/staff` returns inactive people of
 * its own accord. A booking taken in March may name a service that has since
 * been archived or a colleague who has since left, and a lookup that resolves
 * only the live catalogue renders that booking as a blank. The archive is not
 * optional here; it is most of the point.
 */

/**
 * One flat namespace, not per-business. Every one of these calls is scoped to
 * the tenant in the token and there is no way to ask for another, so a business
 * id in the key would be decoration — and `AuthProvider` clears the whole cache
 * on sign-out, which is what actually keeps one tenant's names out of the next
 * session.
 */
export const referenceKeys = {
  all: ['reference'] as const,
  services: ['reference', 'services'] as const,
  staff: ['reference', 'staff'] as const,
}

/**
 * The whole catalogue, archive included.
 *
 * `?size=100` rather than the plan's 200, because 200 is not a request the
 * server honours: `PaginationConfig` clamps silently at 100 and answers
 * `"size": 100` — verified on the running stack, not read off a javadoc. Asking
 * for a number that gets quietly halved would make this call state something
 * untrue about what it expects back.
 *
 * **No `?sort=`.** The endpoint orders by name server-side and documents that
 * `?sort=` is not honoured, so sending one would be a parameter with no effect
 * and an ordering assumption with no basis.
 *
 * `totalPages > 1` is logged rather than thrown. A tenant with more than a
 * hundred services is a real paging task and a wave-7 concern; what must not
 * happen is a partial map rendering as a screen of resolved names with a few
 * silent blanks in it, which is indistinguishable from working.
 */
export async function fetchServices(signal?: AbortSignal): Promise<Service[]> {
  const response = await client.get(SERVICES_PATH, {
    params: { size: MAX_PAGE_SIZE },
    signal,
  })
  const page = servicePageSchema.parse(response.data)

  if (page.totalPages > 1) {
    console.error(
      `[lookups] ${page.totalElements} services across ${page.totalPages} pages; only the first ${page.size} are cached. ` +
        'Bookings naming a service beyond that page will render without a name. Paging the reference layer is now due.',
    )
  }

  return page.content
}

/**
 * The whole team, inactive included. A plain array — this endpoint is not paged,
 * so there is no envelope and no `totalPages` to assert.
 */
export async function fetchTeam(signal?: AbortSignal): Promise<Staff[]> {
  const response = await client.get(STAFF_PATH, { signal })
  return staffListSchema.parse(response.data)
}
