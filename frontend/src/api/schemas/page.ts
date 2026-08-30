import { z } from 'zod'

/**
 * The paginated envelope from brief §6, and the one cap that goes with it.
 *
 * Five members in a fixed order — `content`, `page`, `size`, `totalElements`,
 * `totalPages` — because the backend returns its own `PageResponse` record and
 * never a Spring `Page`, whose JSON shape is not a contract and changed between
 * Boot minors. springdoc names each instantiation after its element type, so
 * `PageResponse<ServiceResponse>` is published as `PageResponseServiceResponse`
 * and that is the name the registry has to use.
 */
export function pageResponse<T extends z.ZodType>(item: T) {
  return z.object({
    content: z.array(item),
    /** Zero-based, matching the `?page=` that was sent (`PaginationConfig`). */
    page: z.number().int().nonnegative(),
    /** **What was applied, not what was asked for** — see {@link MAX_PAGE_SIZE}. */
    size: z.number().int().positive(),
    totalElements: z.number().int().nonnegative(),
    /** Zero when there are no rows at all, which is why `> 1` is the drift test. */
    totalPages: z.number().int().nonnegative(),
  })
}

/**
 * 100, and asking for more is not an error — it is silently clamped.
 *
 * `PaginationConfig.MAX_PAGE_SIZE` on the backend, verified on the running
 * stack: `GET /api/services?size=200` answers `"size": 100`. The wave plan says
 * to send 200, and sending it would make the request state something the server
 * does not honour — the same category of mistake as the `?sort=` the plan
 * correctly tells us not to send. So the reference fetches ask for exactly this,
 * and the `totalPages` assertion beside them is what actually catches a tenant
 * that has outgrown one page. Recorded as a deviation in the wave's decisions.
 */
export const MAX_PAGE_SIZE = 100
