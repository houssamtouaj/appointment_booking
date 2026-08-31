import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import axe from 'axe-core'

import { resetBootstrap } from '@/api/bootstrap'
import { client, resetInFlightRefresh } from '@/api/client'
import { createQueryClient } from '@/api/query-client'
import { endSessionQuietly } from '@/api/session'
import { AuthProvider } from '@/features/auth/auth-provider'
import { routes } from '@/routes'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
  Toaster: () => null,
}))

/**
 * The catalogue screen, and mostly the two things on it that are wrong silently.
 *
 * - **`bookable: false` rendered like `active: false`.** An owner then reads an
 *   archived-looking row as "I switched that off" and never finds out that a
 *   service they are selling offers no times. The gate names this and it is the
 *   first test below.
 * - **A price that arrives as the wrong integer.** `12.10` must reach the API as
 *   `1210`. The screen looks identical whether it sends `1210`, `12` or `121`, and
 *   the first anyone would know is a customer being charged wrongly — so the
 *   assertion is on the request body, which is also demo step 4.
 *
 * Fixtures are the demo's shape: a Paris salon, one colleague who has left, one
 * archived service, and — the point of the screen — two *different* reasons for a
 * live service not being bookable.
 */

vi.setConfig({ testTimeout: 15_000 })

const AMELIE = {
  id: '33333333-3333-3333-3333-333333333333',
  email: 'amelie@slotflow.app',
  fullName: 'Amélie Rousseau',
  role: 'STAFF' as const,
  active: true,
  accepted: true,
  invitationPending: false,
  serviceIds: [] as string[],
}

/** Deactivated. Still assigned to Permanente, which is why it sells nothing. */
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
  // Widened rather than `as const`, because `session` is reassigned to the staff
  // fixture below and a narrowed literal makes that a type error.
  role: 'OWNER' as 'OWNER' | 'STAFF',
  business: {
    id: '66666666-6666-6666-6666-666666666666',
    slug: 'demo-salon',
    name: 'Belle Époque',
    timezone: 'Europe/Paris',
    currency: 'EUR',
  },
}

const STAFF_SESSION = {
  ...OWNER,
  id: AMELIE.id,
  email: AMELIE.email,
  fullName: AMELIE.fullName,
  role: 'STAFF' as const,
}

const BOOKABLE = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  name: 'Coupe classique',
  description: 'Wash, cut and finish.',
  durationMinutes: 60,
  priceCents: 3500,
  bufferBeforeMinutes: 5,
  bufferAfterMinutes: 10,
  totalBlockMinutes: 75,
  active: true,
  bookable: true,
  staffIds: [AMELIE.id],
}

/** Live, priced, and nobody performs it. The row this screen exists for. */
const NOBODY_ASSIGNED = {
  ...BOOKABLE,
  id: 'aaaaaaaa-0000-4000-8000-000000000002',
  name: 'Couleur',
  priceCents: 7200,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  totalBlockMinutes: 90,
  durationMinutes: 90,
  bookable: false,
  staffIds: [],
}

/** Live, and its only performer has been deactivated. A different sentence. */
const PERFORMER_LEFT = {
  ...BOOKABLE,
  id: 'aaaaaaaa-0000-4000-8000-000000000003',
  name: 'Permanente',
  bookable: false,
  staffIds: [MARC.id],
}

const ARCHIVED = {
  ...BOOKABLE,
  id: 'aaaaaaaa-0000-4000-8000-000000000004',
  name: 'Massage du dos',
  active: false,
  bookable: false,
}

// --- the stub API ----------------------------------------------------------

let catalogue: (typeof BOOKABLE)[] = []
let team: (typeof AMELIE)[] = []
let requests: AxiosRequestConfig[] = []
let session = OWNER
/** Set to make the next screen fetch fail. */
let listStatus = 200
/** Set to make the reference layer's roster fail while the catalogue still answers. */
let staffStatus = 200
let writeAnswer: ((config: AxiosRequestConfig) => { data: unknown; status: number }) | undefined

/** The screen's own fetch, told apart from the reference layer's by its size. */
function isScreenList(config: AxiosRequestConfig): boolean {
  return (
    (config.url ?? '').startsWith('/api/services') &&
    (config.method ?? 'get').toLowerCase() === 'get' &&
    config.params?.size !== 100
  )
}

function screenLists(): AxiosRequestConfig[] {
  return requests.filter(isScreenList)
}

function referenceStaffReads(): AxiosRequestConfig[] {
  return requests.filter(
    (config) => config.url === '/api/staff' && (config.method ?? 'get').toLowerCase() === 'get',
  )
}

function stubApi() {
  const adapter: AxiosAdapter = (config: AxiosRequestConfig) => {
    const url = config.url ?? ''
    const method = (config.method ?? 'get').toLowerCase()
    requests.push(config)

    let data: unknown = null
    let status = 200

    if (url === '/api/auth/refresh') {
      data = { accessToken: 't', tokenType: 'Bearer', expiresIn: 900, user: session }
    } else if (url === '/api/auth/me') {
      // `AuthProvider` seeds `me` from the refresh and then verifies it, so this
      // is asked for on every cold mount. Answering it with `null` is what makes
      // a whole file of tests land on the login screen.
      data = session
    } else if (method !== 'get') {
      const answer = writeAnswer?.(config)
      if (answer) {
        data = answer.data
        status = answer.status
      } else {
        status = 500
      }
    } else if (url === '/api/staff') {
      if (staffStatus >= 400) {
        status = staffStatus
        data = { code: 'INTERNAL_ERROR', detail: 'The roster is having a moment.' }
      } else {
        data = team
      }
    } else if (url.startsWith('/api/services')) {
      const screen = isScreenList(config)
      if (screen && listStatus >= 400) {
        status = listStatus
        data = { code: 'INTERNAL_ERROR', detail: 'The catalogue is having a moment.' }
      } else {
        const active = config.params?.active as boolean | undefined
        const rows =
          screen && active !== undefined
            ? catalogue.filter((service) => service.active === active)
            : catalogue
        data = {
          content: rows,
          page: Number(config.params?.page ?? 0),
          size: Number(config.params?.size ?? 20),
          totalElements: rows.length,
          totalPages: rows.length === 0 ? 0 : 1,
        }
      }
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

async function renderCatalog(path = '/services') {
  stubApi()
  const mounted = mount(path)
  await waitFor(() => expect(screen.queryByText('Restoring your session')).not.toBeInTheDocument())
  return mounted
}

/** The `<li>` a named service is drawn in. */
function rowFor(name: string): HTMLElement {
  // A row's heading is an `h2` — the level below the page title, which is what
  // keeps axe's `heading-order` quiet and a screen reader's outline honest.
  const heading = screen.getByRole('heading', { name, level: 2 })
  const row = heading.closest('li')
  if (!row) throw new Error(`no row for ${name}`)
  return row
}

beforeEach(() => {
  catalogue = [BOOKABLE, NOBODY_ASSIGNED, PERFORMER_LEFT, ARCHIVED]
  team = [AMELIE, MARC]
  requests = []
  session = OWNER
  listStatus = 200
  staffStatus = 200
  writeAnswer = undefined
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  endSessionQuietly()
  resetBootstrap()
  resetInFlightRefresh()
  client.defaults.adapter = undefined
})

describe('the three row states', () => {
  it('never renders an unbookable live service the same as an archived one', async () => {
    // The wave's gate item, and the reason the chip has three values rather than
    // reading `active`. Both rows produce no availability; only one of them is a
    // decision the owner made.
    await renderCatalog('/services?active=all')

    await waitFor(() => expect(rowFor('Coupe classique')).toBeInTheDocument())

    expect(within(rowFor('Coupe classique')).getByText('Bookable')).toBeInTheDocument()
    expect(within(rowFor('Couleur')).getByText('Not bookable')).toBeInTheDocument()
    expect(within(rowFor('Massage du dos')).getByText('Archived')).toBeInTheDocument()

    // And the difference is not only the word: the unbookable row offers a fix,
    // the archived one offers a restore.
    expect(
      within(rowFor('Couleur')).getByRole('button', { name: /not bookable/i }),
    ).toBeInTheDocument()
    expect(
      within(rowFor('Massage du dos')).getByRole('button', { name: /reactivate/i }),
    ).toBeInTheDocument()
  })

  it('names the reason, and names it differently for the two causes', async () => {
    await renderCatalog('/services?active=all')
    await waitFor(() => expect(rowFor('Couleur')).toBeInTheDocument())

    // In the accessible name, so it is heard without opening anything.
    expect(
      within(rowFor('Couleur')).getByRole('button', { name: /nobody is assigned to perform it/i }),
    ).toBeInTheDocument()
    expect(
      within(rowFor('Permanente')).getByRole('button', {
        name: /Marc Lefèvre is the only person assigned to it, and they have been deactivated/i,
      }),
    ).toBeInTheDocument()
  })

  it('shows the buffers and the total block, and omits both when there are none', async () => {
    await renderCatalog('/services?active=all')
    await waitFor(() => expect(rowFor('Coupe classique')).toBeInTheDocument())

    expect(
      within(rowFor('Coupe classique')).getByText('1 hr · +5 before / +10 after · blocks 75 min'),
    ).toBeInTheDocument()
    // Couleur has no buffers, so "blocks 90 min" would restate the duration.
    expect(within(rowFor('Couleur')).getByText('1 hr 30 min')).toBeInTheDocument()
  })

  it('prices from the business currency, never a hard-coded symbol', async () => {
    await renderCatalog('/services?active=all')
    await waitFor(() => expect(rowFor('Couleur')).toBeInTheDocument())
    expect(within(rowFor('Couleur')).getByText(/72[.,]00/)).toBeInTheDocument()
  })
})

describe('the tabs', () => {
  it('opens on the active catalogue and asks the API for active=true', async () => {
    await renderCatalog()
    await waitFor(() => expect(screenLists().length).toBeGreaterThan(0))

    expect(screenLists()[0]?.params).toMatchObject({ active: true, page: 0 })
    expect(screen.queryByRole('heading', { name: 'Massage du dos', level: 2 })).toBeNull()
  })

  it('opens the archive straight from the URL', async () => {
    // Demo step 1: both tabs, from the URL.
    await renderCatalog('/services?active=false')
    await waitFor(() => expect(rowFor('Massage du dos')).toBeInTheDocument())

    expect(screenLists()[0]?.params).toMatchObject({ active: false })
    expect(screen.queryByRole('heading', { name: 'Coupe classique', level: 2 })).toBeNull()
  })

  it('never sends the All tab’s ?active=all to the API', async () => {
    // The URL spells All as `active=all` so that the no-parameter state can be
    // the default tab; the *request* must still omit the parameter entirely.
    await renderCatalog('/services?active=all')
    await waitFor(() => expect(rowFor('Massage du dos')).toBeInTheDocument())

    expect(screenLists()[0]?.params?.active).toBeUndefined()
  })

  it('puts the tab in the URL when it is clicked', async () => {
    const user = userEvent.setup()
    const { router } = await renderCatalog()
    await waitFor(() => expect(rowFor('Coupe classique')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Archived' }))

    await waitFor(() => expect(router.state.location.search).toBe('?active=false'))
    // The default tab is spelled by *not* being in the URL, so the nav link and
    // the tab agree on one address.
    await user.click(screen.getByRole('button', { name: 'Active' }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })
})

describe('fixing an unbookable row from its chip', () => {
  it('sends the whole staff set and flips the row without a reload', async () => {
    // Demo step 3. The PATCH must carry every existing id plus the new one:
    // `staffIds` replaces the assignment set server-side.
    const user = userEvent.setup()
    writeAnswer = (config) => {
      const body = JSON.parse(String(config.data)) as { staffIds: string[] }
      const updated = { ...PERFORMER_LEFT, staffIds: body.staffIds, bookable: true }
      catalogue = catalogue.map((service) => (service.id === PERFORMER_LEFT.id ? updated : service))
      return { data: updated, status: 200 }
    }

    await renderCatalog('/services?active=all')
    await waitFor(() => expect(rowFor('Permanente')).toBeInTheDocument())

    await user.click(within(rowFor('Permanente')).getByRole('button', { name: /not bookable/i }))
    await user.click(await screen.findByRole('button', { name: 'Amélie Rousseau' }))

    const patch = requests.find((config) => (config.method ?? '').toLowerCase() === 'patch')
    expect(patch?.url).toBe(`/api/services/${PERFORMER_LEFT.id}`)
    expect(JSON.parse(String(patch?.data))).toEqual({ staffIds: [MARC.id, AMELIE.id] })

    await waitFor(() =>
      expect(within(rowFor('Permanente')).getByText('Bookable')).toBeInTheDocument(),
    )
  })

  it('only offers colleagues who are active — assigning a departed one fixes nothing', async () => {
    const user = userEvent.setup()
    await renderCatalog('/services?active=all')
    await waitFor(() => expect(rowFor('Couleur')).toBeInTheDocument())

    await user.click(within(rowFor('Couleur')).getByRole('button', { name: /not bookable/i }))

    expect(await screen.findByRole('button', { name: 'Amélie Rousseau' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Marc Lefèvre' })).toBeNull()
  })

  it('invalidates the reference cache, so the calendar’s names follow', async () => {
    // The wave gate: every mutation invalidates `useLookups()`. Observable as a
    // second `GET /api/staff` — the roster this app resolves every booking's
    // colleague from.
    const user = userEvent.setup()
    writeAnswer = () => ({ data: { ...PERFORMER_LEFT, bookable: true }, status: 200 })

    await renderCatalog('/services?active=all')
    await waitFor(() => expect(rowFor('Permanente')).toBeInTheDocument())
    const before = referenceStaffReads().length

    await user.click(within(rowFor('Permanente')).getByRole('button', { name: /not bookable/i }))
    await user.click(await screen.findByRole('button', { name: 'Amélie Rousseau' }))

    await waitFor(() => expect(referenceStaffReads().length).toBeGreaterThan(before))
  })
})

describe('the service form', () => {
  it('sends 1210 for a price of 12.10', async () => {
    // Demo step 4, and the assertion is on the wire because the screen looks the
    // same whichever integer it sent.
    const user = userEvent.setup()
    writeAnswer = () => ({ data: { ...BOOKABLE, priceCents: 1210 }, status: 200 })

    await renderCatalog()
    await waitFor(() => expect(rowFor('Coupe classique')).toBeInTheDocument())

    await user.click(within(rowFor('Coupe classique')).getByRole('button', { name: /^edit/i }))
    const price = await screen.findByLabelText('Price (EUR)')
    await user.clear(price)
    await user.type(price, '12.10')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      const patch = requests.find((config) => (config.method ?? '').toLowerCase() === 'patch')
      expect(JSON.parse(String(patch?.data))).toEqual({ priceCents: 1210 })
    })
  })

  it('previews the block the buffers add to the duration', async () => {
    const user = userEvent.setup()
    await renderCatalog()
    await waitFor(() => expect(rowFor('Coupe classique')).toBeInTheDocument())

    await user.click(within(rowFor('Coupe classique')).getByRole('button', { name: /^edit/i }))

    expect(
      await screen.findByText('One appointment blocks 1 hr 15 min of the calendar.'),
    ).toBeInTheDocument()
  })

  it('says once that changing a price is safe for existing bookings', async () => {
    // Bookings snapshot their terms (backend D14). It is the question an owner
    // hesitates over, and it is only worth saying where the hesitation happens.
    const user = userEvent.setup()
    await renderCatalog()
    await waitFor(() => expect(rowFor('Coupe classique')).toBeInTheDocument())

    await user.click(within(rowFor('Coupe classique')).getByRole('button', { name: /^edit/i }))

    expect(
      await screen.findByText(/Existing bookings keep the price they were taken at/i),
    ).toBeInTheDocument()
  })

  it('warns before saving a live service nobody can perform, then allows it', async () => {
    const user = userEvent.setup()
    let created: AxiosRequestConfig | undefined
    writeAnswer = (config) => {
      created = config
      return { data: { ...NOBODY_ASSIGNED, name: 'Brushing' }, status: 201 }
    }

    await renderCatalog()
    await waitFor(() => expect(rowFor('Coupe classique')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /new service/i }))
    await user.type(await screen.findByLabelText('Name'), 'Brushing')
    await user.type(screen.getByLabelText('Duration'), '30')
    await user.type(screen.getByLabelText('Price (EUR)'), '25')
    await user.click(screen.getByRole('button', { name: 'Create service' }))

    // First press: warned, nothing sent.
    expect(await screen.findByText('Nobody is assigned to perform this')).toBeInTheDocument()
    expect(created).toBeUndefined()

    // Second press, on the explicit button: sent, because the state is legal and
    // the API documents it.
    await user.click(screen.getByRole('button', { name: /save without anyone assigned/i }))

    await waitFor(() => expect(created).toBeDefined())
    expect(JSON.parse(String(created?.data))).toMatchObject({
      name: 'Brushing',
      durationMinutes: 30,
      priceCents: 2500,
      staffIds: [],
    })
  })

  it('lands 422 STAFF_NOT_IN_BUSINESS on the staff field', async () => {
    const user = userEvent.setup()
    writeAnswer = () => ({
      data: {
        code: 'STAFF_NOT_IN_BUSINESS',
        detail: 'Those staff members are not part of this business.',
        staffIds: [MARC.id],
      },
      status: 422,
    })

    await renderCatalog()
    await waitFor(() => expect(rowFor('Coupe classique')).toBeInTheDocument())

    await user.click(within(rowFor('Coupe classique')).getByRole('button', { name: /^edit/i }))
    await user.click(await screen.findByLabelText(/Marc Lefèvre/))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText(/no longer part of this business/i)).toBeInTheDocument()
  })

  it('closes without a request when nothing was changed', async () => {
    const user = userEvent.setup()
    await renderCatalog()
    await waitFor(() => expect(rowFor('Coupe classique')).toBeInTheDocument())

    await user.click(within(rowFor('Coupe classique')).getByRole('button', { name: /^edit/i }))
    await user.click(await screen.findByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(screen.queryByText('Edit service')).toBeNull())
    expect(requests.some((config) => (config.method ?? '').toLowerCase() === 'patch')).toBe(false)
  })

  it('shows a deactivated colleague’s tick, so the set on screen is the set that is sent', async () => {
    const user = userEvent.setup()
    await renderCatalog('/services?active=all')
    await waitFor(() => expect(rowFor('Permanente')).toBeInTheDocument())

    await user.click(within(rowFor('Permanente')).getByRole('button', { name: /^edit/i }))

    const marc = await screen.findByLabelText(/Marc Lefèvre · deactivated/)
    expect(marc).toBeChecked()
  })
})

describe('deactivating', () => {
  it('sends DELETE and drops the row out of the active tab', async () => {
    // Demo step 5. `DELETE` answers 200 with `active: false`; there is no hard
    // delete on offer, which is why the button says Deactivate.
    const user = userEvent.setup()
    writeAnswer = () => {
      catalogue = catalogue.map((service) =>
        service.id === BOOKABLE.id ? { ...service, active: false, bookable: false } : service,
      )
      return { data: { ...BOOKABLE, active: false, bookable: false }, status: 200 }
    }

    await renderCatalog()
    await waitFor(() => expect(rowFor('Coupe classique')).toBeInTheDocument())

    await user.click(
      within(rowFor('Coupe classique')).getByRole('button', { name: /^deactivate/i }),
    )

    await waitFor(() => {
      const deletes = requests.filter((config) => (config.method ?? '').toLowerCase() === 'delete')
      expect(deletes[0]?.url).toBe(`/api/services/${BOOKABLE.id}`)
    })
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Coupe classique', level: 2 })).toBeNull(),
    )
  })

  it('reactivates from the archive with a PATCH of active: true', async () => {
    const user = userEvent.setup()
    writeAnswer = () => ({ data: { ...ARCHIVED, active: true }, status: 200 })

    await renderCatalog('/services?active=false')
    await waitFor(() => expect(rowFor('Massage du dos')).toBeInTheDocument())

    await user.click(within(rowFor('Massage du dos')).getByRole('button', { name: /^reactivate/i }))

    await waitFor(() => {
      const patch = requests.find((config) => (config.method ?? '').toLowerCase() === 'patch')
      expect(patch?.url).toBe(`/api/services/${ARCHIVED.id}`)
      expect(JSON.parse(String(patch?.data))).toEqual({ active: true })
    })
  })
})

describe('the three states of the list', () => {
  it('holds the geometry of the list while it loads', async () => {
    stubApi()
    mount('/services')
    expect(await screen.findByText('Loading your services')).toBeInTheDocument()
  })

  it('offers the one action that fixes an empty catalogue', async () => {
    catalogue = []
    const user = userEvent.setup()
    await renderCatalog()

    expect(await screen.findByText('No services yet')).toBeInTheDocument()
    // Two buttons with this name — the header's and the empty state's. The empty
    // one is the point: it is where somebody looking at nothing is looking.
    const buttons = screen.getAllByRole('button', { name: /new service/i })
    const inEmptyState = buttons.at(-1)
    if (!inEmptyState) throw new Error('no New service button')
    await user.click(inEmptyState)
    // The dialog, identified by a field rather than by its heading: the heading
    // is also the name of the two buttons that open it.
    expect(await screen.findByLabelText('Name')).toBeInTheDocument()
  })

  it('sends an empty archive back to the active tab', async () => {
    catalogue = [BOOKABLE]
    const user = userEvent.setup()
    const { router } = await renderCatalog('/services?active=false')

    expect(await screen.findByText('Nothing is archived')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /back to active services/i }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })

  it('offers a retry when the list fails', async () => {
    listStatus = 500
    const user = userEvent.setup()
    await renderCatalog()

    // `shouldRetry` allows two retries for a 5xx, with exponential backoff, so
    // the error state is a few seconds away rather than a tick.
    expect(
      await screen.findByText('Your services could not be loaded', undefined, { timeout: 10_000 }),
    ).toBeInTheDocument()

    listStatus = 200
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(rowFor('Coupe classique')).toBeInTheDocument())
  })

  it('renders the rows anyway when only the team fails to load', async () => {
    // Unlike the calendar, where a booking with no name is an unidentifiable
    // appointment and there is nothing left worth drawing. Every fact on these
    // rows comes from the catalogue response, so the list is still worth showing
    // without the roster — and what is missing is said rather than implied.
    staffStatus = 500
    await renderCatalog()

    expect(
      await screen.findByText(/Your team could not be loaded/i, undefined, { timeout: 10_000 }),
    ).toBeInTheDocument()
    await waitFor(() => expect(rowFor('Coupe classique')).toBeInTheDocument())
  })
})

describe('who may see this screen', () => {
  it('redirects a staff session away from /services', async () => {
    // Demo step 10. Hiding the nav link is the courtesy; this is the permission.
    session = STAFF_SESSION
    const { router } = await renderCatalog('/services')

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
  })
})

describe('axe', () => {
  /**
   * `color-contrast` off and only that rule, for the reason wave 6 records at
   * length: jsdom has no layout engine, so the rule cannot run rather than
   * failing, and leaving it on produces "incomplete" results that read as
   * passes.
   */
  const options = { rules: { 'color-contrast': { enabled: false } } } as const

  it('reports nothing with all three row states on screen', async () => {
    await renderCatalog('/services?active=all')
    await waitFor(() => expect(rowFor('Couleur')).toBeInTheDocument())

    const main = document.querySelector('main')
    if (!main) throw new Error('no main')
    const result = await axe.run(main, options)
    expect(result.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
  })

  it('reports nothing with the service form open', async () => {
    const user = userEvent.setup()
    await renderCatalog()
    await waitFor(() => expect(rowFor('Coupe classique')).toBeInTheDocument())

    await user.click(within(rowFor('Coupe classique')).getByRole('button', { name: /^edit/i }))
    const dialog = await screen.findByRole('dialog')

    const result = await axe.run(dialog, options)
    expect(result.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
  })
})
