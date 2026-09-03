import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import type { ServiceQuery } from '@/api/catalog'
import type { TKey } from '@/i18n'

/**
 * Which tab of the catalogue is open, and which page of it — both in the URL.
 *
 * The demo's first step is "active tab, archived tab, both from the URL", so
 * these are query parameters rather than `useState`: a link to somebody's
 * archive is a link, and the back button walks back through the tabs.
 */

/** `?active=` — the same name the API takes, so the URL reads like the request. */
export const ACTIVE_PARAM = 'active'
export const PAGE_PARAM = 'page'

export const TABS = ['active', 'archived', 'all'] as const

export type ServiceTab = (typeof TABS)[number]

export const TAB_LABEL: Record<ServiceTab, TKey> = {
  active: 'services.tabs.active',
  archived: 'services.tabs.archived',
  all: 'services.tabs.all',
}

/**
 * The URL's value for each tab, and **the one deviation from the wave plan.**
 *
 * The plan maps the three tabs to `?active=true|false|<omitted>`. Two of those
 * are right and the third cannot be: *omitted* is also what a person arriving
 * from the nav link has, and the tab they should land on is Active — an owner
 * opening Services wants the catalogue they are selling, not the catalogue plus
 * the archive. Making All the no-parameter state would open the screen on a list
 * mixing live and archived rows, which is the one view where the wave's own gate
 * item ("`bookable === false` is never rendered the same as archived") is
 * hardest to read.
 *
 * So All is spelled `?active=all`, which is not a value the endpoint accepts and
 * is never sent to it — {@link tabQuery} drops it. The *request* still follows
 * the plan exactly: `true`, `false`, or the parameter omitted.
 */
const TAB_VALUE: Record<ServiceTab, string> = {
  active: 'true',
  archived: 'false',
  all: 'all',
}

/** The default. Absent, unreadable and misspelled all land here. */
export const DEFAULT_TAB: ServiceTab = 'active'

function tabFrom(raw: string | null): ServiceTab {
  if (raw === null) return DEFAULT_TAB
  return TABS.find((tab) => TAB_VALUE[tab] === raw) ?? DEFAULT_TAB
}

/**
 * The tab as `GET /api/services` takes it: `active: true`, `false`, or the key
 * absent.
 *
 * Absent and not `undefined`-valued by accident — Axios drops `undefined`
 * params, which is what makes the All tab an omitted parameter rather than
 * `?active=undefined`. Written as an explicit branch anyway, because relying on
 * that quietly is how the third tab breaks the day the client changes.
 */
export function tabQuery(tab: ServiceTab): Pick<ServiceQuery, 'active'> {
  if (tab === 'active') return { active: true }
  if (tab === 'archived') return { active: false }
  return {}
}

export type ServiceParams = {
  tab: ServiceTab
  /** Zero-based, matching `PageResponse.page`. */
  page: number
  setTab: (tab: ServiceTab) => void
  setPage: (page: number) => void
}

export function useServiceParams(): ServiceParams {
  const [params, setParams] = useSearchParams()

  const tab = tabFrom(params.get(ACTIVE_PARAM))

  const rawPage = Number(params.get(PAGE_PARAM))
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 0

  /** One writer, so changing the tab cannot leave a page number behind. */
  const patch = useCallback(
    (changes: Record<string, string | undefined>) => {
      setParams((previous) => {
        const next = new URLSearchParams(previous)
        for (const [key, value] of Object.entries(changes)) {
          if (value === undefined) next.delete(key)
          else next.set(key, value)
        }
        return next
      })
    },
    [setParams],
  )

  return useMemo(
    () => ({
      tab,
      page,
      setTab: (next: ServiceTab) =>
        patch({
          // The default tab is spelled by *not* being in the URL, so that the
          // nav link and the tab agree on one address rather than two.
          [ACTIVE_PARAM]: next === DEFAULT_TAB ? undefined : TAB_VALUE[next],
          // Page 3 of the active catalogue is very often past the end of the
          // archive, and an empty page that really means "you have gone too far"
          // is the least helpful screen there is.
          [PAGE_PARAM]: undefined,
        }),
      setPage: (next: number) => patch({ [PAGE_PARAM]: next === 0 ? undefined : String(next) }),
    }),
    [tab, page, patch],
  )
}
