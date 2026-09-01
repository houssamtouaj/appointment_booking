import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import axe from 'axe-core'

import { resetBootstrap } from '@/api/bootstrap'
import { client, resetInFlightRefresh } from '@/api/client'
import { createQueryClient } from '@/api/query-client'
import { endSessionQuietly } from '@/api/session'
import { dashboardKeys } from '@/api/dashboard'
import { AuthProvider } from '@/features/auth/auth-provider'
import { WEEK_GRID_MIN_WIDTH } from '@/hooks/use-media-query'
import { routes } from '@/routes'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
  Toaster: () => null,
}))

/**
 * Fifteen seconds, and it buys warm-up rather than slowness.
 *
 * The first test here mounts the route table, which pulls in every feature in
 * the app. Run on its own the whole file finishes in about two seconds; run in
 * parallel with twenty-four other jsdom environments it has been observed to
 * spend the default 5s budget on the transform before its first assertion. The
 * ceiling is raised rather than the test made to do less, and a real hang still
 * fails — three times later than it did.
 */
vi.setConfig({ testTimeout: 15_000 })

/**
 * The calendar, and mostly the things that look right when they are wrong.
 *
 * Three classes of failure on this screen are invisible on inspection, and each
 * one has tests here rather than a demo step to catch it:
 *
 * - **An appointment drawn underneath another appointment.** Two staff at the
 *   same hour is normal; a grid that stacks them looks like a tidy calendar with
 *   one fewer booking on it, and the person it belonged to finds out when the
 *   customer arrives.
 * - **A truncated week.** A hundred bookings render as a complete-looking
 *   calendar that is missing Thursday afternoon.
 * - **An optimistic update that does not roll back.** The tile stays changed,
 *   the server never agreed, and the screen and the database disagree silently
 *   until the next refetch.
 *
 * The fixtures are the demo's shape: a Paris salon, one archived service, one
 * colleague who has left, and a week in September 2026.
 */

const TZ = 'Europe/Paris'

/** Monday of the week every fixture below sits in. */
const MONDAY = '2026-08-31'

const SERVICE = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Coupe classique',
  description: 'Wash, cut and finish.',
  durationMinutes: 60,
  priceCents: 3500,
  bufferBeforeMinutes: 5,
  bufferAfterMinutes: 10,
  totalBlockMinutes: 75,
  active: true,
  bookable: true,
  staffIds: [],
}

/** Archived. A booking from March still names it. */
const ARCHIVED_SERVICE = {
  ...SERVICE,
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Permanente',
  active: false,
  bookable: false,
}

const AMELIE = {
  id: '33333333-3333-3333-3333-333333333333',
  email: 'amelie@slotflow.app',
  fullName: 'Amélie Rousseau',
  role: 'STAFF' as const,
  active: true,
  accepted: true,
  invitationPending: false,
  serviceIds: [],
}

/** Deactivated, and still the person who took the appointment. */
const MARC = {
  ...AMELIE,
  id: '44444444-4444-4444-4444-444444444444',
  email: 'marc@slotflow.app',
  fullName: 'Marc Lefèvre',
  active: false,
}

const OWNER = {
  id: '55555555-5555-5555-5555-555555555555',
  email: 'demo@slotflow.app',
  fullName: 'Camille Bérard',
  role: 'OWNER' as const,
  business: {
    id: '66666666-6666-6666-6666-666666666666',
    slug: 'belle-epoque',
    name: 'Belle Époque',
    timezone: TZ,
    currency: 'EUR',
  },
}

/** 2026-09-01 is a Tuesday. Paris is on CEST, so 08:00Z is 10:00 local. */
function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    serviceId: SERVICE.id,
    staffId: AMELIE.id,
    guestName: 'Yasmine Haddad',
    startsAt: '2026-09-01T08:00:00Z',
    endsAt: '2026-09-01T09:00:00Z',
    status: 'CONFIRMED',
    priceCents: 3500,
    ...overrides,
  }
}

function detail(overrides: Record<string, unknown> = {}) {
  const summary = booking(overrides)
  return {
    ...summary,
    guest: {
      name: summary.guestName,
      email: 'yasmine@example.com',
      phone: '+33 6 12 34 56 78',
    },
    // Five minutes before and ten after — the appointment is 10:00–11:00 local,
    // so the calendar actually loses 09:55–11:10.
    blockedFrom: '2026-09-01T07:55:00Z',
    blockedTo: '2026-09-01T09:10:00Z',
    depositPaidCents: 1000,
    outstandingCents: 2500,
    bufferBeforeMinutes: 5,
    bufferAfterMinutes: 10,
    notes: 'Allergic to the usual shampoo.',
    createdAt: '2026-08-20T09:00:00Z',
    updatedAt: '2026-08-20T09:00:00Z',
    ...overrides,
  }
}

// --- the stub API ----------------------------------------------------------

type Handler = (config: AxiosRequestConfig) => { data: unknown; status?: number } | undefined

/**
 * jsdom has no layout engine, so `matchMedia` matches nothing by default — which
 * this screen correctly reads as a narrow viewport and answers with the day
 * view. Every test therefore has to say how wide it is standing, and the default
 * below is the desktop the week grid is for.
 */
function setViewport(wide: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: wide && query === WEEK_GRID_MIN_WIDTH,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

/**
 * Stand at an instant, with the clock still running.
 *
 * `shouldAdvanceTime` matters: the time guards read `new Date()`, and a frozen
 * clock also freezes the timers Testing Library's `waitFor` runs on.
 */
function standAt(iso: string) {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(iso))
}

let bookingRows: ReturnType<typeof booking>[] = []
/** Set to hold every PATCH open, so the optimistic patch can be seen alone. */
let patchGate: Promise<void> | undefined
let totalPagesOverride: number | undefined
let bookingRequests: AxiosRequestConfig[] = []
let patchHandler: Handler | undefined
let detailBody: unknown

function stubApi() {
  const adapter: AxiosAdapter = (config: AxiosRequestConfig) => {
    const url = config.url ?? ''
    const method = (config.method ?? 'get').toLowerCase()
    let data: unknown = OWNER
    let status = 200

    if (url === '/api/auth/refresh') {
      data = { accessToken: 't', tokenType: 'Bearer', expiresIn: 900, user: OWNER }
    } else if (method === 'patch' && /\/api\/bookings\/.+\/status/.test(url)) {
      if (patchGate) return holdThenAnswer(config) as ReturnType<AxiosAdapter>
      const answer = patchHandler?.(config)
      if (!answer) {
        return Promise.reject(
          Object.assign(new Error('no patch handler'), {
            isAxiosError: true,
            config,
            response: { status: 500, data: {}, headers: {}, config },
          }),
        ) as ReturnType<AxiosAdapter>
      }
      data = answer.data
      status = answer.status ?? 200
    } else if (/\/api\/bookings\/[^/]+$/.test(url)) {
      data = detailBody ?? detail()
    } else if (url === '/api/bookings') {
      bookingRequests.push(config)
      const size = Number(config.params?.size ?? 20)
      data = {
        content: bookingRows,
        page: Number(config.params?.page ?? 0),
        size,
        totalElements: bookingRows.length,
        totalPages: totalPagesOverride ?? (bookingRows.length === 0 ? 0 : 1),
      }
    } else if (url === '/api/policy') {
      data = {
        minLeadTimeHours: 2,
        maxAdvanceDays: 60,
        cancellationCutoffHours: 24,
        slotGranularityMinutes: 15,
        updatedAt: '2026-08-01T00:00:00Z',
      }
    } else if (url.includes('/api/public/businesses/')) {
      data = {
        id: OWNER.business.id,
        slug: OWNER.business.slug,
        name: OWNER.business.name,
        timezone: TZ,
        currency: 'EUR',
        depositRequired: false,
        openingHours: [
          { dayOfWeek: 'TUESDAY', opensAt: '09:00:00', closesAt: '19:00:00', closesNextDay: false },
        ],
        services: [],
      }
    } else if (url.includes('/api/services')) {
      data = {
        content: [SERVICE, ARCHIVED_SERVICE],
        page: 0,
        size: 100,
        totalElements: 2,
        totalPages: 1,
      }
    } else if (url.includes('/api/staff')) {
      data = [AMELIE, MARC]
    }

    if (status >= 400) {
      return Promise.reject(
        Object.assign(new Error('stub failure'), {
          isAxiosError: true,
          config,
          response: { status, data, headers: {}, config },
        }),
      ) as ReturnType<AxiosAdapter>
    }

    return Promise.resolve({
      data,
      status,
      statusText: 'OK',
      headers: {},
      config: config as AxiosResponse['config'],
    }) as ReturnType<AxiosAdapter>
  }
  client.defaults.adapter = adapter

  /** A PATCH that does not answer until the test lets it. */
  async function holdThenAnswer(config: AxiosRequestConfig): Promise<AxiosResponse> {
    await patchGate
    const answer = patchHandler?.(config) ?? { data: {} }
    return {
      data: answer.data,
      status: answer.status ?? 200,
      statusText: 'OK',
      headers: {},
      config: config as AxiosResponse['config'],
    }
  }
}

function mount(path: string) {
  const queryClient = createQueryClient()
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return { router, queryClient }
}

async function renderCalendar(path = `/calendar?date=${MONDAY}`) {
  stubApi()
  const mounted = mount(path)
  await waitFor(() => expect(screen.queryByText('Restoring your session')).not.toBeInTheDocument())
  return mounted
}

/** The tile for a guest, by the accessible name every tile carries in full. */
function tileFor(name: string | RegExp) {
  return screen.getByRole('button', { name: typeof name === 'string' ? new RegExp(name) : name })
}

beforeEach(() => {
  setViewport(true)
  patchGate = undefined
  bookingRows = [booking()]
  totalPagesOverride = undefined
  bookingRequests = []
  detailBody = undefined
  patchHandler = (config) => ({
    data: { ...detail(), status: JSON.parse(String(config.data)).status },
  })
  resetInFlightRefresh()
  resetBootstrap()
  endSessionQuietly()
  vi.mocked(toast.error).mockClear()
  vi.mocked(toast.success).mockClear()
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------

describe('the week', () => {
  it('asks for the business week as instants, with an exclusive end', async () => {
    await renderCalendar()
    await screen.findByRole('button', { name: /Yasmine Haddad/ })

    const params = bookingRequests[0]?.params
    // Paris is on CEST, so the week begins at 22:00Z the Sunday before and ends
    // at 22:00Z on the following Sunday — exclusive, unlike the dashboard's
    // inclusive dates.
    expect(params?.from).toBe('2026-08-30T22:00:00.000Z')
    expect(params?.to).toBe('2026-09-06T22:00:00.000Z')
  })

  it('asks for a page size the server actually honours', async () => {
    await renderCalendar()
    await screen.findByRole('button', { name: /Yasmine Haddad/ })

    // Not the plan's 200: `PaginationConfig` clamps silently at 100, and asking
    // for a number that gets halved would make the request state something
    // untrue about what it expects back.
    expect(bookingRequests[0]?.params?.size).toBe(100)
  })

  it('names an archived service and a colleague who has left', async () => {
    // Both lists are fetched unfiltered precisely so a booking from March
    // renders with both names on it rather than with two gaps.
    bookingRows = [booking({ serviceId: ARCHIVED_SERVICE.id, staffId: MARC.id })]
    await renderCalendar()

    expect(await screen.findByRole('button', { name: /Permanente/ })).toBeInTheDocument()
    expect(tileFor('Marc Lefèvre')).toBeInTheDocument()
  })

  it('gives every booking an accessible name carrying the time position conveys', async () => {
    await renderCalendar()

    // A visual grid says *when* by position. A screen reader gets none of it, so
    // the name has to carry the whole appointment.
    expect(
      await screen.findByRole('button', {
        name: 'Yasmine Haddad, Coupe classique with Amélie Rousseau, 10:00 to 11:00, confirmed',
      }),
    ).toBeInTheDocument()
  })

  it('refuses to draw a week that does not fit on one page', async () => {
    // The gate item. A truncated week renders as a complete-looking calendar
    // with a day missing from it, so it must not be a thing anybody is shown.
    totalPagesOverride = 3
    await renderCalendar()

    expect(
      await screen.findByText(/more appointments than the calendar can show/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Yasmine Haddad/ })).not.toBeInTheDocument()
  })
})

describe('two staff at the same hour', () => {
  it('sits them side by side, neither hidden', async () => {
    bookingRows = [
      booking(),
      booking({
        id: 'aaaaaaaa-0000-4000-8000-000000000002',
        staffId: MARC.id,
        guestName: 'Léa Petit',
      }),
    ]
    await renderCalendar()

    const yasmine = await screen.findByRole('button', { name: /Yasmine Haddad/ })
    const lea = tileFor('Léa Petit')

    // Both present, and at different horizontal offsets — which is the whole
    // claim. Equal `left` would mean one is drawn on top of the other.
    expect(yasmine.style.width).toBe('50%')
    expect(lea.style.width).toBe('50%')
    expect(yasmine.style.left).not.toBe(lea.style.left)
  })
})

describe('the detail sheet', () => {
  it('opens on click with the contact details, the money and the blocked range', async () => {
    const user = userEvent.setup()
    await renderCalendar()

    await user.click(await screen.findByRole('button', { name: /Yasmine Haddad/ }))
    const sheet = await screen.findByRole('dialog')

    expect(within(sheet).getByText('yasmine@example.com')).toBeInTheDocument()
    expect(within(sheet).getByText('+33 6 12 34 56 78')).toBeInTheDocument()
    expect(within(sheet).getByText('Allergic to the usual shampoo.')).toBeInTheDocument()
    expect(within(sheet).getByText(/35[.,]00/)).toBeInTheDocument()
    expect(within(sheet).getByText(/25[.,]00/)).toBeInTheDocument()

    // The appointment and the blocked range are different facts, and the sheet
    // is the only place the second one exists.
    expect(within(sheet).getByText('10:00 – 11:00')).toBeInTheDocument()
    expect(within(sheet).getByText('09:55 – 11:10')).toBeInTheDocument()
    expect(within(sheet).getByText(/5 min before and 10 min after/)).toBeInTheDocument()
  })

  it('is deep-linked, so a dashboard row can open it', async () => {
    await renderCalendar(`/calendar?date=${MONDAY}&booking=${booking().id}`)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(await screen.findByText('yasmine@example.com')).toBeInTheDocument()
  })

  it('returns focus to the tile that opened it when Escape closes it', async () => {
    const user = userEvent.setup()
    await renderCalendar()

    await user.click(await screen.findByRole('button', { name: /Yasmine Haddad/ }))
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Queried again rather than reusing the reference: closing the sheet changes
    // the URL, so the grid re-renders and the node may not be the same one.
    await waitFor(() => expect(tileFor('Yasmine Haddad')).toHaveFocus())
  })
})

describe('changing a status', () => {
  /** A booking that finished yesterday, so `COMPLETED` is not time-guarded. */
  function past() {
    return booking({ startsAt: '2026-08-31T08:00:00Z', endsAt: '2026-08-31T09:00:00Z' })
  }

  it('changes the tile before the response lands', async () => {
    standAt('2026-09-02T12:00:00Z')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    bookingRows = [past()]
    detailBody = detail({ startsAt: '2026-08-31T08:00:00Z', endsAt: '2026-08-31T09:00:00Z' })

    // The PATCH is held open, so anything on screen before it is released is the
    // optimistic patch and nothing else.
    let release: (() => void) | undefined
    patchGate = new Promise<void>((resolve) => {
      release = resolve
    })
    patchHandler = () => ({ data: detail({ status: 'COMPLETED' }) })

    await renderCalendar()
    await user.click(await screen.findByRole('button', { name: /Yasmine Haddad/ }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Completed' }))

    // Still in flight, and the tile already says so — F14's whole claim.
    //
    // `hidden: true` because the sheet is a modal and Radix marks the rest of
    // the page `aria-hidden` while it is open. The tile is on screen and is what
    // is being asserted about; it is simply not in the accessibility tree at
    // this moment, which is correct behaviour and not what this test is for.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Yasmine Haddad.*completed/, hidden: true }),
      ).toBeInTheDocument(),
    )
    expect(toast.success).not.toHaveBeenCalled()

    release?.()
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
  })

  it('rolls the tile back and toasts when the server refuses', async () => {
    standAt('2026-09-02T12:00:00Z')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    bookingRows = [past()]
    detailBody = detail({ startsAt: '2026-08-31T08:00:00Z', endsAt: '2026-08-31T09:00:00Z' })
    patchHandler = () => ({ status: 500, data: { title: 'Server error', code: 'INTERNAL_ERROR' } })

    await renderCalendar()
    await user.click(await screen.findByRole('button', { name: /Yasmine Haddad/ }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Completed' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    // Back to what the server still believes. `hidden: true` for the same reason
    // as above — the sheet is still open over it.
    expect(
      await screen.findByRole('button', { name: /Yasmine Haddad.*confirmed/, hidden: true }),
    ).toBeInTheDocument()
  })

  it('names the transition a 409 refused', async () => {
    const user = userEvent.setup()
    bookingRows = [past()]
    detailBody = detail({ startsAt: '2026-08-31T08:00:00Z', endsAt: '2026-08-31T09:00:00Z' })
    patchHandler = () => ({
      status: 409,
      data: {
        title: 'Conflict',
        detail: 'A CANCELLED booking cannot become COMPLETED: it is terminal',
        code: 'ILLEGAL_TRANSITION',
        from: 'CANCELLED',
        to: 'COMPLETED',
      },
    })
    standAt('2026-09-02T12:00:00Z')

    await renderCalendar()
    await user.click(await screen.findByRole('button', { name: /Yasmine Haddad/ }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Completed' }))

    // The generic sentence leaves a person pressing the button again. This one
    // says the row is not what they thought it was.
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'A cancelled booking cannot be marked completed.',
        expect.anything(),
      ),
    )
  })

  it('invalidates the dashboard as well as the calendar', async () => {
    const user = userEvent.setup()
    standAt('2026-09-02T12:00:00Z')
    bookingRows = [past()]
    detailBody = detail({ startsAt: '2026-08-31T08:00:00Z', endsAt: '2026-08-31T09:00:00Z' })

    const { queryClient } = await renderCalendar()

    // A dashboard response already in the cache, as it would be for somebody who
    // opened the dashboard first — which is the common path.
    const statsKey = dashboardKeys.stats({ from: MONDAY, to: '2026-09-06', tz: TZ })
    queryClient.setQueryData(statsKey, { revenueCents: 0 })

    await user.click(await screen.findByRole('button', { name: /Yasmine Haddad/ }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Completed' }))

    // `revenueCents`, `weekBookings` and `noShowRate` all move when a booking
    // completes, and the dashboard is one click away. Leaving them stale means
    // an owner marks a booking done and finds the money unchanged.
    await waitFor(() => expect(queryClient.getQueryState(statsKey)?.isInvalidated).toBe(true))
  })

  it('disables a no-show on a future appointment, with the reason in words', async () => {
    // The fixture starts 2026-09-01T08:00Z; stand well before it.
    standAt('2026-08-31T09:00:00Z')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await renderCalendar()
    await user.click(await screen.findByRole('button', { name: /Yasmine Haddad/ }))
    await screen.findByRole('dialog')

    expect(screen.getByRole('button', { name: 'No-show' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Completed' })).toBeDisabled()
    // A `title` is unreachable by touch, so the reason is on screen too.
    expect(screen.getByText(/once it has finished/i)).toBeInTheDocument()
  })
})

describe('filters', () => {
  it('put the colleague in the URL, so a filtered week is a link', async () => {
    const user = userEvent.setup()
    const { router } = await renderCalendar()
    await screen.findByRole('button', { name: /Yasmine Haddad/ })

    await user.selectOptions(screen.getByLabelText('Filter by colleague'), AMELIE.id)

    await waitFor(() => expect(router.state.location.search).toContain(`staff=${AMELIE.id}`))
    await waitFor(() => expect(bookingRequests.at(-1)?.params?.staffId).toBe(AMELIE.id))
  })

  it('are read back off the URL on a fresh load', async () => {
    await renderCalendar(`/calendar?date=${MONDAY}&staff=${AMELIE.id}&status=CONFIRMED`)
    await screen.findByRole('button', { name: /Yasmine Haddad/ })

    expect(bookingRequests[0]?.params?.staffId).toBe(AMELIE.id)
    expect(bookingRequests[0]?.params?.status).toBe('CONFIRMED')
  })

  it('ignore a status the API has never heard of rather than sending it', async () => {
    await renderCalendar(`/calendar?date=${MONDAY}&status=DONE`)
    await screen.findByRole('button', { name: /Yasmine Haddad/ })

    expect(bookingRequests[0]?.params?.status).toBeUndefined()
  })
})

describe('the keyboard', () => {
  it('gives the whole grid one tab stop, and moves within a day with the arrows', async () => {
    const user = userEvent.setup()
    bookingRows = [
      booking(),
      booking({
        id: 'aaaaaaaa-0000-4000-8000-000000000003',
        guestName: 'Léa Petit',
        staffId: MARC.id,
        startsAt: '2026-09-01T12:00:00Z',
        endsAt: '2026-09-01T13:00:00Z',
      }),
    ]
    await renderCalendar()
    await screen.findByRole('button', { name: /Yasmine Haddad/ })

    const tiles = [tileFor('Yasmine Haddad'), tileFor('Léa Petit')]
    // Sixty tab stops between the toolbar and the page below is not a calendar.
    expect(tiles.filter((tile) => tile.tabIndex === 0)).toHaveLength(1)

    tiles[0]?.focus()
    await user.keyboard('{ArrowDown}')
    expect(tileFor('Léa Petit')).toHaveFocus()

    await user.keyboard('{ArrowUp}')
    expect(tileFor('Yasmine Haddad')).toHaveFocus()

    await user.keyboard('{End}')
    expect(tileFor('Léa Petit')).toHaveFocus()
  })

  it('moves between days with PageDown, skipping days with nothing on them', async () => {
    const user = userEvent.setup()
    bookingRows = [
      booking(),
      // Friday — Wednesday and Thursday are empty and must be stepped over,
      // because there is nothing on them to focus.
      booking({
        id: 'aaaaaaaa-0000-4000-8000-000000000004',
        guestName: 'Léa Petit',
        startsAt: '2026-09-04T08:00:00Z',
        endsAt: '2026-09-04T09:00:00Z',
      }),
    ]
    await renderCalendar()
    await screen.findByRole('button', { name: /Yasmine Haddad/ })

    tileFor('Yasmine Haddad').focus()
    await user.keyboard('{PageDown}')
    expect(tileFor('Léa Petit')).toHaveFocus()

    await user.keyboard('{PageUp}')
    expect(tileFor('Yasmine Haddad')).toHaveFocus()
  })

  it('opens the sheet with Enter', async () => {
    const user = userEvent.setup()
    await renderCalendar()

    ;(await screen.findByRole('button', { name: /Yasmine Haddad/ })).focus()
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})

describe('an empty week', () => {
  it('says so and offers the nearest week that has something', async () => {
    const user = userEvent.setup()
    bookingRows = []
    const { router } = await renderCalendar()

    expect(await screen.findByText('Nothing booked this week')).toBeInTheDocument()

    // The search finds a booking two weeks on and the picker moves to its week.
    bookingRows = [booking({ startsAt: '2026-09-15T08:00:00Z', endsAt: '2026-09-15T09:00:00Z' })]
    await user.click(screen.getByRole('button', { name: /find the nearest week/i }))

    await waitFor(() => expect(router.state.location.search).toContain('date=2026-09-15'))
  })

  it('offers the filters back rather than another empty week when one is set', async () => {
    bookingRows = []
    await renderCalendar(`/calendar?date=${MONDAY}&staff=${AMELIE.id}`)

    // Sending somebody to another week that is empty for the same reason is not
    // a next step.
    expect(await screen.findByText(/nothing matches these filters/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /clear filters/i })).toBeInTheDocument()
  })
})

describe('the list view', () => {
  it('shows the status in words, not only as a colour', async () => {
    bookingRows = [booking({ status: 'NO_SHOW' })]
    await renderCalendar(`/calendar?date=${MONDAY}&view=list`)

    const row = await screen.findByRole('button', { name: /Yasmine Haddad/ })
    expect(within(row).getByText('No-show')).toBeInTheDocument()
  })

  it('pages server-side, with the page in the URL', async () => {
    await renderCalendar(`/calendar?date=${MONDAY}&view=list&page=2`)
    await screen.findByRole('button', { name: /Yasmine Haddad/ })

    expect(bookingRequests[0]?.params?.page).toBe(2)
    expect(bookingRequests[0]?.params?.size).toBe(25)
  })
})

describe('at 375px', () => {
  it('shows the day view with staff columns instead of scrolling a week sideways', async () => {
    // Demo step 10. Seven legible day columns are about 900px wide, so a phone
    // would have to scroll sideways to read one — and a calendar you scroll
    // sideways cannot show Thursday and Friday at once, which is the only reason
    // to draw a week.
    setViewport(false)
    bookingRows = [
      booking(),
      booking({
        id: 'aaaaaaaa-0000-4000-8000-000000000005',
        staffId: MARC.id,
        guestName: 'Léa Petit',
      }),
    ]
    await renderCalendar('/calendar?date=2026-09-01')

    // Columns are the two colleagues, not the seven days.
    expect(await screen.findByRole('region', { name: /Amélie Rousseau/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /Marc Lefèvre/ })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Thursday/ })).not.toBeInTheDocument()
  })

  it('keeps the week button visible and refusing, rather than making it vanish', async () => {
    setViewport(false)
    await renderCalendar()

    // A control that disappears at a breakpoint leaves somebody who was using it
    // wondering what they did; one that explains itself does not.
    const week = await screen.findByRole('radio', { name: 'Week' })
    expect(week).toHaveAttribute('aria-disabled', 'true')
    // `aria-disabled` and not `disabled`, so it is focusable — which is the only
    // way anybody meets the explanation. This is a touch-only state, so a
    // `title` alone would reach nobody at all.
    expect(week).not.toBeDisabled()
    expect(week).toHaveAccessibleDescription(/wider screen/)
    expect(screen.getByText('The week grid needs a wider screen')).toBeInTheDocument()
  })

  it('ignores a press on the refused option instead of switching to a week it cannot draw', async () => {
    setViewport(false)
    const user = userEvent.setup()
    const { router } = await renderCalendar()

    // Choose the day explicitly first, so that a press on the refused option has
    // something to overwrite and its no-op is observable.
    await user.click(await screen.findByRole('radio', { name: 'Day' }))
    await waitFor(() => expect(router.state.location.search).toContain('view=day'))

    // An `aria-disabled` button is a real button, so the refusal is the
    // component's job rather than the platform's.
    await user.click(screen.getByRole('radio', { name: 'Week' }))

    expect(router.state.location.search).toContain('view=day')
    expect(router.state.location.search).not.toContain('view=week')
  })

  it('leaves the chosen view in the URL, so the same link is a week on a laptop', async () => {
    setViewport(false)
    const { router } = await renderCalendar()
    await screen.findByRole('radiogroup', { name: 'Calendar view' })

    // The degradation is derived, never written back. A person who chose the
    // week keeps it when they open the same link somewhere wider.
    expect(router.state.location.search).not.toContain('view=')
  })
})

describe('a quiet day in a busy week', () => {
  it('offers the nearest day rather than an empty column with no explanation', async () => {
    const user = userEvent.setup()
    setViewport(false)
    // Tuesday has the appointment; the phone opens on Wednesday.
    bookingRows = [booking()]
    const { router } = await renderCalendar('/calendar?date=2026-09-02')

    expect(await screen.findByText('Nothing booked on this day')).toBeInTheDocument()
    expect(screen.getByText(/appointments elsewhere this week/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Go to Tuesday/i }))
    await waitFor(() => expect(router.state.location.search).toContain('date=2026-09-01'))
    expect(await screen.findByRole('button', { name: /Yasmine Haddad/ })).toBeInTheDocument()
  })

  it('says the whole week is free when it is, and offers nothing', async () => {
    setViewport(false)
    bookingRows = []
    await renderCalendar('/calendar?date=2026-09-02')

    // The week-level empty state owns this case; the day view must not claim
    // there is somewhere better to be.
    expect(await screen.findByText('Nothing booked this week')).toBeInTheDocument()
  })
})

describe('axe', () => {
  /**
   * `color-contrast` is off, and only that rule.
   *
   * jsdom has no layout engine and no rendering, so axe cannot resolve a
   * computed colour against what is actually painted behind it — the rule does
   * not fail here, it cannot run, and leaving it on produces "incomplete"
   * results that read as passes. Contrast is instead recorded against every
   * foreground token in `styles/theme.css` and checked by the Lighthouse budget
   * the brief sets.
   */
  const options = { rules: { 'color-contrast': { enabled: false } } } as const

  async function violationsIn(element: Element) {
    const result = await axe.run(element, options)
    return result.violations.map((violation) => `${violation.id}: ${violation.help}`)
  }

  it('reports nothing on the week grid', async () => {
    bookingRows = [
      booking(),
      booking({
        id: 'aaaaaaaa-0000-4000-8000-000000000006',
        staffId: MARC.id,
        guestName: 'Léa Petit',
      }),
    ]
    await renderCalendar()
    await screen.findByRole('button', { name: /Yasmine Haddad/ })

    expect(await violationsIn(document.body)).toEqual([])
  })

  it('reports nothing on the detail sheet', async () => {
    const user = userEvent.setup()
    await renderCalendar()

    await user.click(await screen.findByRole('button', { name: /Yasmine Haddad/ }))
    const sheet = await screen.findByRole('dialog')
    await within(sheet).findByText('yasmine@example.com')

    expect(await violationsIn(document.body)).toEqual([])
  })

  it('reports nothing on the list view', async () => {
    await renderCalendar(`/calendar?date=${MONDAY}&view=list`)
    await screen.findByRole('button', { name: /Yasmine Haddad/ })

    expect(await violationsIn(document.body)).toEqual([])
  })
})
