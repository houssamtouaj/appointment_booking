import { client } from '@/api/client'
import { dashboardStatsSchema, type DashboardStats } from '@/api/schemas/dashboard'
import type { DayRange } from '@/lib/time'

/**
 * `GET /api/dashboard/stats` — one endpoint, two answers.
 *
 * There is no `?staffId=` and there must never be one. An `OWNER` token gets the
 * business; a `STAFF` token gets only its own bookings, in every figure, decided
 * server-side from the role. Same URL, different numbers per login, by design —
 * which is why the screen says whose figures these are rather than leaving the
 * difference to read as a bug.
 */

const STATS_PATH = '/api/dashboard/stats'

export type StatsRequest = DayRange & {
  /**
   * The **business's** zone (F8). Sending none makes the API use it anyway, so
   * this is redundant on the wire and not redundant in the source: it makes the
   * request state the assumption the screen is rendering under, and it is the
   * line that would have to change if a viewer-zone dashboard were ever wanted.
   */
  tz: string
}

export const dashboardKeys = {
  all: ['dashboard'] as const,
  stats: (request: StatsRequest) => ['dashboard', 'stats', request] as const,
}

/**
 * `from` and `to` are **dates, both inclusive**.
 *
 * This is the opposite end of the convention `GET /api/bookings` uses, where
 * `to` is an exclusive instant, and getting the two the same way round is a
 * silently-wrong week rather than an error. The endpoint reads them in the
 * business timezone and runs the range to midnight following `to`.
 *
 * They travel as a pair or not at all: one bound without the other is a `422`,
 * because the server fills each bound from the default week independently and
 * `?to=` alone would silently mean "from this Monday back to last February" — an
 * empty interval and a wall of zeroes that reads as a quiet month.
 */
export async function fetchDashboardStats(
  request: StatsRequest,
  signal?: AbortSignal,
): Promise<DashboardStats> {
  const response = await client.get(STATS_PATH, {
    params: { from: request.from, to: request.to, tz: request.tz },
    signal,
  })
  return dashboardStatsSchema.parse(response.data)
}
