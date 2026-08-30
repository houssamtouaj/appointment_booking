import { QueryClient } from '@tanstack/react-query'

import { isApiError } from '@/api/error'

/**
 * Whether a failed read is worth asking about again.
 *
 * **Never retry a 4xx.** A 403 does not get better by asking again, a 422 is the
 * same shape every time, and a 404 three times over is three times the latency
 * before the empty state a person could already have been reading. Retries are
 * for the failures that are genuinely transient: a 5xx, and a request that never
 * got an answer at all.
 *
 * `status === 0` is that second case. `toApiError` gives a network failure status
 * 0 because there is no HTTP status to give it, and the plain `>= 500` test would
 * classify a dropped packet as permanent — which is the one failure most worth
 * retrying.
 *
 * Exported as well as used as the default, so a query with an extra reason to
 * give up can decline first and then defer to this rather than restating it —
 * the calendar's week does exactly that.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (!isApiError(error)) return failureCount < 2
  if (error.status === 0 || error.status >= 500) return failureCount < 2
  return false
}

/**
 * The TanStack Query defaults, decided once here so that no feature has to
 * think about them (F7).
 *
 * A factory rather than a module-level singleton: every test that touches a
 * query needs its own cache, and a shared one turns "this test passes alone and
 * fails in the suite" into a recurring afternoon.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        /**
         * **Never retry a 4xx.** A 403 does not get better by asking again, a
         * 422 is the same shape every time, and a 404 three times over is three
         * times the latency before the empty state a person could already have
         * been reading. Retries are for the failures that are genuinely
         * transient: a 5xx, and a request that never got an answer at all.
         *
         * `status === 0` is that second case. `toApiError` gives a network
         * failure status 0 because there is no HTTP status to give it, and the
         * plain `>= 500` test would classify a dropped packet as permanent —
         * which is the one failure most worth retrying.
         */
        retry: shouldRetry,
        /**
         * Thirty seconds. Long enough that moving between two admin screens does
         * not refetch, short enough that a booking taken on another device shows
         * up without a reload. Reference data — services, staff — overrides this
         * to five minutes in wave 5, where it belongs next to the query.
         */
        staleTime: 30_000,
        /**
         * Off by default, on for the calendar and the dashboard, which override
         * it. The default has to be off because most screens in this app are
         * forms: refetching under a half-filled booking form either discards
         * what was typed or fights it, and neither is worth a fresher number.
         */
        refetchOnWindowFocus: false,
      },
      mutations: {
        // A mutation is a side effect. Retrying one automatically is how a
        // double booking gets created out of a network blip.
        retry: false,
      },
    },
  })
}
