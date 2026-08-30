import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { client } from '@/api/client'
import { createQueryClient } from '@/api/query-client'
import { serviceNameIn, staffNameIn, useLookups } from '@/hooks/use-lookups'

/**
 * The reference-data layer (F7).
 *
 * The gate item this file exists for is a *count*: `useLookups()` issues two
 * requests per session, not two per screen. That is invisible on screen — three
 * screens each fetching the same catalogue look exactly like three screens
 * sharing one — so it is asserted by counting requests, which is the only way it
 * can fail loudly.
 *
 * The second gate item is the one that decides whether a calendar renders names
 * or blanks: both lists are fetched **unfiltered**, so a booking naming an
 * archived service or somebody who has left still resolves.
 */

const ACTIVE_SERVICE = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Coupe classique',
  description: 'Wash, cut and finish.',
  durationMinutes: 30,
  priceCents: 3500,
  bufferBeforeMinutes: 5,
  bufferAfterMinutes: 5,
  totalBlockMinutes: 40,
  active: true,
  bookable: true,
  staffIds: [],
}

/** Archived months ago, and still named by every booking taken before then. */
const ARCHIVED_SERVICE = {
  ...ACTIVE_SERVICE,
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Permanente',
  active: false,
  bookable: false,
}

const CURRENT_STAFF = {
  id: '33333333-3333-3333-3333-333333333333',
  email: 'amelie@slotflow.app',
  fullName: 'Amélie Rousseau',
  role: 'STAFF',
  active: true,
  accepted: true,
  invitationPending: false,
  serviceIds: [],
}

/** Left in June. Her March bookings did not leave with her. */
const FORMER_STAFF = {
  ...CURRENT_STAFF,
  id: '44444444-4444-4444-4444-444444444444',
  email: 'marc@slotflow.app',
  fullName: 'Marc Lefèvre',
  active: false,
}

let calls: AxiosRequestConfig[] = []
let servicePage: unknown

function stubApi() {
  const adapter: AxiosAdapter = (config: AxiosRequestConfig) => {
    calls.push(config)
    const url = config.url ?? ''
    const data = url.includes('/api/services') ? servicePage : [CURRENT_STAFF, FORMER_STAFF]
    return Promise.resolve({
      data,
      status: 200,
      statusText: 'OK',
      headers: {},
      config: config as AxiosResponse['config'],
    }) as ReturnType<AxiosAdapter>
  }
  client.defaults.adapter = adapter
}

/** Two independent consumers, so "one cache" is a claim two components make. */
function Consumer({ label }: { label: string }) {
  const lookups = useLookups()
  if (lookups.isLoading) return <p>{label} loading</p>
  return (
    <p>
      {label}: {serviceNameIn(lookups, ARCHIVED_SERVICE.id)} with{' '}
      {staffNameIn(lookups, FORMER_STAFF.id)}
    </p>
  )
}

function pathsCalled(path: string) {
  return calls.filter((call) => (call.url ?? '').includes(path))
}

beforeEach(() => {
  calls = []
  servicePage = {
    content: [ACTIVE_SERVICE, ARCHIVED_SERVICE],
    page: 0,
    size: 100,
    totalElements: 2,
    totalPages: 1,
  }
  stubApi()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useLookups', () => {
  it('issues two requests for two consumers, not four', async () => {
    const queryClient = createQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <Consumer label="one" />
        <Consumer label="two" />
      </QueryClientProvider>,
    )

    await screen.findByText(/^one:/)
    await screen.findByText(/^two:/)

    expect(pathsCalled('/api/services')).toHaveLength(1)
    expect(pathsCalled('/api/staff')).toHaveLength(1)
  })

  it('serves a later screen from the cache rather than refetching', async () => {
    const queryClient = createQueryClient()
    const first = render(
      <QueryClientProvider client={queryClient}>
        <Consumer label="one" />
      </QueryClientProvider>,
    )
    await screen.findByText(/^one:/)
    first.unmount()

    // The same session navigating to another screen: a new tree, the same
    // client. `staleTime` is what makes this free, and dropping it is the change
    // that would turn two requests per session into two per screen.
    render(
      <QueryClientProvider client={queryClient}>
        <Consumer label="two" />
      </QueryClientProvider>,
    )
    await screen.findByText(/^two:/)

    expect(pathsCalled('/api/services')).toHaveLength(1)
    expect(pathsCalled('/api/staff')).toHaveLength(1)
  })

  it('asks for the whole catalogue and sends no sort', async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <Consumer label="one" />
      </QueryClientProvider>,
    )
    await screen.findByText(/^one:/)

    const [services] = pathsCalled('/api/services')
    // 100, which is what `PaginationConfig` actually applies. Asking for 200
    // would be a request the server silently halves.
    expect(services?.params).toEqual({ size: 100 })
    // No `?active=`: the archive is most of the point. And no `?sort=` — the
    // endpoint documents that it does not honour one.
    expect(services?.params).not.toHaveProperty('active')
    expect(services?.params).not.toHaveProperty('sort')
  })

  it('resolves an archived service and a colleague who has left', async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <Consumer label="one" />
      </QueryClientProvider>,
    )

    // Both rows are inactive, and both still have names. This is the assertion
    // that fails the day somebody adds `?active=true` to make the list shorter.
    expect(await screen.findByText('one: Permanente with Marc Lefèvre')).toBeInTheDocument()
  })

  it('says so loudly when the catalogue does not fit one page', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    servicePage = {
      content: [ACTIVE_SERVICE],
      page: 0,
      size: 100,
      totalElements: 140,
      totalPages: 2,
    }

    render(
      <QueryClientProvider client={createQueryClient()}>
        <Consumer label="one" />
      </QueryClientProvider>,
    )
    await screen.findByText(/^one:/)

    // A partial map renders as a working screen with a few silent blanks in it,
    // which is the failure worth being noisy about.
    await waitFor(() => expect(logged).toHaveBeenCalled())
    expect(logged.mock.calls[0]?.[0]).toContain('140 services across 2 pages')
  })

  it('names a lookup that missed rather than printing a uuid', async () => {
    servicePage = { content: [], page: 0, size: 100, totalElements: 0, totalPages: 0 }

    render(
      <QueryClientProvider client={createQueryClient()}>
        <Consumer label="one" />
      </QueryClientProvider>,
    )

    expect(await screen.findByText(/Unknown service/)).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(ARCHIVED_SERVICE.id))).not.toBeInTheDocument()
  })
})
