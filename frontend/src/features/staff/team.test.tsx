import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import axe from 'axe-core'

import { resetBootstrap } from '@/api/bootstrap'
import { serviceKeys } from '@/api/catalog'
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
 * The team screen. Two things on it are worth a test each and the rest follows.
 *
 * - **Four states from three booleans.** `active`, `accepted` and
 *   `invitationPending` combine into four rows an owner has to tell apart, and
 *   each takes a different action. Getting one wrong offers *Reactivate* to
 *   somebody who never had a password — a `409` an owner cannot interpret — or
 *   leaves them waiting on an invitation that expired days ago. All four are
 *   rendered from fixtures here, deactivated included, which is a gate item.
 * - **The deactivation warning.** It has to be a panel that stays, with numbers
 *   in it and a working undo. A regression to a toast would look completely fine
 *   in a screenshot and lose the only information on the screen that somebody
 *   needs to act on.
 */

vi.setConfig({ testTimeout: 15_000 })

const TZ = 'Europe/Paris'

const CAMILLE = {
  id: '55555555-5555-5555-5555-555555555555',
  email: 'demo@slotflow.app',
  fullName: 'Camille Bérard',
  // Widened rather than `as const`: every other fixture in this file is spread
  // from this one and two of them are `STAFF`.
  role: 'OWNER' as 'OWNER' | 'STAFF',
  active: true,
  accepted: true,
  invitationPending: false,
  serviceIds: [] as string[],
}

const SERVICE = {
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
  staffIds: [] as string[],
}

const ARCHIVED_SERVICE = {
  ...SERVICE,
  id: 'aaaaaaaa-0000-4000-8000-000000000002',
  name: 'Permanente',
  active: false,
  bookable: false,
}

/** Active and accepted. */
const AMELIE = {
  ...CAMILLE,
  id: '33333333-3333-3333-3333-333333333333',
  email: 'amelie@slotflow.app',
  fullName: 'Amélie Rousseau',
  role: 'STAFF' as const,
  serviceIds: [SERVICE.id, ARCHIVED_SERVICE.id],
}

/** Invited: a live link, no password yet. */
const SAM = {
  ...AMELIE,
  id: '77777777-7777-7777-7777-777777777777',
  email: 'sam@example.com',
  fullName: 'Sam Ferreira',
  active: false,
  accepted: false,
  invitationPending: true,
  serviceIds: [] as string[],
}

/** The fourth state the plan's table does not list: seven days ran out. */
const LEA = {
  ...SAM,
  id: '88888888-8888-8888-8888-888888888888',
  email: 'lea@example.com',
  fullName: 'Léa Petit',
  invitationPending: false,
}

/** Deactivated: accepted once, cannot sign in now. */
const MARC = {
  ...AMELIE,
  id: '44444444-4444-4444-4444-444444444444',
  email: 'marc@slotflow.app',
  fullName: 'Marc Lefèvre',
  active: false,
  serviceIds: [] as string[],
}

/** A second owner, so Camille stops being the last one. */
const SECOND_OWNER = {
  ...CAMILLE,
  id: '99999999-9999-9999-9999-999999999999',
  email: 'nadia@slotflow.app',
  fullName: 'Nadia Cherif',
}

const OWNER_SESSION = {
  id: CAMILLE.id,
  email: CAMILLE.email,
  fullName: CAMILLE.fullName,
  // Widened, for the same reason as `CAMILLE.role`: `session` is reassigned to
  // the staff fixture in the redirect test.
  role: 'OWNER' as 'OWNER' | 'STAFF',
  business: {
    id: '66666666-6666-6666-6666-666666666666',
    slug: 'demo-salon',
    name: 'Belle Époque',
    timezone: TZ,
    currency: 'EUR',
  },
}

const STAFF_SESSION = { ...OWNER_SESSION, id: AMELIE.id, role: 'STAFF' as const }

/** 2026-09-01 is a Tuesday. Paris is on CEST, so 12:00Z is 14:00 local. */
const WARNING = { upcomingBookings: 4, nextBookingAt: '2026-09-01T12:00:00Z' }

// --- the stub API ----------------------------------------------------------

let team: (typeof CAMILLE)[] = []
let catalogue: (typeof SERVICE)[] = []
let requests: AxiosRequestConfig[] = []
let session = OWNER_SESSION
let teamStatus = 200
let writeAnswer: ((config: AxiosRequestConfig) => { data: unknown; status: number }) | undefined

/**
 * The screen's own writes. `/api/auth/*` is excluded because the bootstrap
 * refresh is itself a `POST`, and counting it makes every "one request was sent"
 * assertion off by one in a way that looks like a bug in the screen.
 */
function writes(method: string): AxiosRequestConfig[] {
  return requests.filter(
    (config) =>
      (config.method ?? 'get').toLowerCase() === method &&
      !(config.url ?? '').startsWith('/api/auth/'),
  )
}

function teamReads(): AxiosRequestConfig[] {
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
      if (teamStatus >= 400) {
        status = teamStatus
        data = { code: 'INTERNAL_ERROR', detail: 'The roster is having a moment.' }
      } else {
        data = team
      }
    } else if (url.startsWith('/api/services')) {
      data = {
        content: catalogue,
        page: 0,
        size: 100,
        totalElements: catalogue.length,
        totalPages: catalogue.length === 0 ? 0 : 1,
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

async function renderTeam(path = '/team') {
  stubApi()
  const mounted = mount(path)
  await waitFor(() => expect(screen.queryByText('Restoring your session')).not.toBeInTheDocument())
  return mounted
}

/** The `<li>` a named colleague is drawn in. */
function rowFor(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { name, level: 2 })
  const row = heading.closest('li')
  if (!row) throw new Error(`no row for ${name}`)
  return row
}

beforeEach(() => {
  team = [CAMILLE, AMELIE, SAM, LEA, MARC]
  catalogue = [SERVICE, ARCHIVED_SERVICE]
  requests = []
  session = OWNER_SESSION
  teamStatus = 200
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

describe('the four states', () => {
  it('renders each one with its own word and its own action', async () => {
    await renderTeam()
    await waitFor(() => expect(rowFor('Amélie Rousseau')).toBeInTheDocument())

    expect(within(rowFor('Amélie Rousseau')).getByText('Active')).toBeInTheDocument()
    expect(
      within(rowFor('Sam Ferreira')).getByText('Invited — awaiting acceptance'),
    ).toBeInTheDocument()
    expect(within(rowFor('Léa Petit')).getByText('Invitation lapsed')).toBeInTheDocument()
    expect(within(rowFor('Marc Lefèvre')).getByText('Deactivated')).toBeInTheDocument()

    // An invitee gets Resend; somebody who accepted and was deactivated gets
    // Reactivate — which the API refuses for an invitee, so offering the wrong
    // one is a 409 an owner cannot interpret.
    expect(
      within(rowFor('Sam Ferreira')).getByRole('button', { name: /resend invitation/i }),
    ).toBeInTheDocument()
    expect(
      within(rowFor('Léa Petit')).getByRole('button', { name: /resend invitation/i }),
    ).toBeInTheDocument()
    expect(
      within(rowFor('Marc Lefèvre')).getByRole('button', { name: /^reactivate/i }),
    ).toBeInTheDocument()
    expect(
      within(rowFor('Sam Ferreira')).queryByRole('button', { name: /^reactivate/i }),
    ).toBeNull()
  })

  it('says a deactivated colleague’s appointments are still in the calendar', async () => {
    await renderTeam()
    await waitFor(() => expect(rowFor('Marc Lefèvre')).toBeInTheDocument())

    expect(
      within(rowFor('Marc Lefèvre')).getByText(/appointments they already had are still/i),
    ).toBeInTheDocument()
  })

  it('joins what each colleague performs from the reference cache', async () => {
    await renderTeam()
    await waitFor(() => expect(rowFor('Amélie Rousseau')).toBeInTheDocument())

    // Archived services are shown and marked: the assignment exists, and hiding
    // it would make this row disagree with the catalogue's own tick boxes.
    expect(
      within(rowFor('Amélie Rousseau')).getByText(/Coupe classique, Permanente \(archived\)/),
    ).toBeInTheDocument()
    expect(
      within(rowFor('Camille Bérard')).getByText('Performs no services yet'),
    ).toBeInTheDocument()
  })

  it('counts the owners in the header, which is the number behind every disabled button', async () => {
    await renderTeam()
    expect(
      await screen.findByText(/2 people can sign in, one of them an owner/i),
    ).toBeInTheDocument()
  })
})

describe('the deactivation warning', () => {
  it('names the count and the next appointment, and stays on screen', async () => {
    const user = userEvent.setup()
    writeAnswer = () => ({
      data: { staff: { ...AMELIE, active: false }, warning: WARNING },
      status: 200,
    })

    await renderTeam()
    await waitFor(() => expect(rowFor('Amélie Rousseau')).toBeInTheDocument())

    await user.click(
      within(rowFor('Amélie Rousseau')).getByRole('button', { name: /^deactivate/i }),
    )

    const alert = await screen.findByRole('alert')
    // 12:00Z on a Tuesday, in Paris, is 14:00. The date's punctuation is the
    // reader's locale's — asserting the exact bytes would fail on an ICU
    // upgrade without anything being wrong — so this pins the parts that are
    // ours: the count, the weekday, the day and the clock.
    expect(alert).toHaveTextContent(
      /Amélie Rousseau has 4 upcoming appointments, the next on Tuesday.*September.*1.* at 14:00\./,
    )
    expect(alert).toHaveTextContent(/stay in the calendar and are not cancelled/i)

    // The link into that filtered week — the calendar reads both parameters from
    // the URL, which is why it put them there.
    expect(within(alert).getByRole('link', { name: /see their appointments/i })).toHaveAttribute(
      'href',
      `/calendar?date=2026-09-01&staff=${AMELIE.id}`,
    )
  })

  it('says "appointment" for one', async () => {
    const user = userEvent.setup()
    writeAnswer = () => ({
      data: {
        staff: { ...AMELIE, active: false },
        warning: { upcomingBookings: 1, nextBookingAt: WARNING.nextBookingAt },
      },
      status: 200,
    })

    await renderTeam()
    await waitFor(() => expect(rowFor('Amélie Rousseau')).toBeInTheDocument())
    await user.click(
      within(rowFor('Amélie Rousseau')).getByRole('button', { name: /^deactivate/i }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('has 1 upcoming appointment,')
  })

  it('undoes with a PATCH of active: true, and clears itself', async () => {
    const user = userEvent.setup()
    writeAnswer = (config) => {
      const body = JSON.parse(String(config.data)) as { active: boolean }
      team = team.map((person) =>
        person.id === AMELIE.id ? { ...person, active: body.active } : person,
      )
      return body.active
        ? { data: { staff: { ...AMELIE, active: true } }, status: 200 }
        : { data: { staff: { ...AMELIE, active: false }, warning: WARNING }, status: 200 }
    }

    await renderTeam()
    await waitFor(() => expect(rowFor('Amélie Rousseau')).toBeInTheDocument())
    await user.click(
      within(rowFor('Amélie Rousseau')).getByRole('button', { name: /^deactivate/i }),
    )

    const alert = await screen.findByRole('alert')
    await user.click(within(alert).getByRole('button', { name: /undo/i }))

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    const patches = writes('patch')
    expect(JSON.parse(String(patches[0]?.data))).toEqual({ active: false })
    expect(JSON.parse(String(patches[1]?.data))).toEqual({ active: true })
  })

  it('does not appear when the person had no appointments ahead of them', async () => {
    // `warning` is absent, not null — the API is `NON_NULL`. Nothing to warn
    // about is a toast, and putting a persistent panel here would train people
    // to dismiss the one that matters.
    const user = userEvent.setup()
    writeAnswer = () => ({ data: { staff: { ...AMELIE, active: false } }, status: 200 })

    await renderTeam()
    await waitFor(() => expect(rowFor('Amélie Rousseau')).toBeInTheDocument())
    await user.click(
      within(rowFor('Amélie Rousseau')).getByRole('button', { name: /^deactivate/i }),
    )

    await waitFor(() => expect(writes('patch').length).toBe(1))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('dismisses', async () => {
    const user = userEvent.setup()
    writeAnswer = () => ({
      data: { staff: { ...AMELIE, active: false }, warning: WARNING },
      status: 200,
    })

    await renderTeam()
    await waitFor(() => expect(rowFor('Amélie Rousseau')).toBeInTheDocument())
    await user.click(
      within(rowFor('Amélie Rousseau')).getByRole('button', { name: /^deactivate/i }),
    )

    const alert = await screen.findByRole('alert')
    await user.click(within(alert).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})

describe('the last owner', () => {
  it('cannot be deactivated, and the row says why', async () => {
    await renderTeam()
    await waitFor(() => expect(rowFor('Camille Bérard')).toBeInTheDocument())

    const button = within(rowFor('Camille Bérard')).getByRole('button', { name: /^deactivate/i })
    expect(button).toBeDisabled()
    // The reason reaches a screen reader, not only a pointer.
    expect(button).toHaveAccessibleDescription(/A business must always have one active owner/i)
  })

  it('is offered normally once there are two owners', async () => {
    team = [CAMILLE, SECOND_OWNER, AMELIE]
    await renderTeam()
    await waitFor(() => expect(rowFor('Camille Bérard')).toBeInTheDocument())

    expect(
      within(rowFor('Camille Bérard')).getByRole('button', { name: /^deactivate/i }),
    ).toBeEnabled()
  })

  it('cannot be demoted from the edit dialog either', async () => {
    const user = userEvent.setup()
    await renderTeam()
    await waitFor(() => expect(rowFor('Camille Bérard')).toBeInTheDocument())

    await user.click(within(rowFor('Camille Bérard')).getByRole('button', { name: /^edit/i }))

    const role = await screen.findByLabelText('Role')
    expect(role).toBeDisabled()
    expect(role).toHaveAccessibleDescription(/A business must always have one active owner/i)
  })

  it('explains a 409 LAST_OWNER that gets through a stale list', async () => {
    // The guard is a copy of a server rule and this list can be a minute old —
    // two tabs, or a colleague demoted a moment ago. The 409 is the correctness.
    const user = userEvent.setup()
    team = [CAMILLE, SECOND_OWNER, AMELIE]
    writeAnswer = () => ({
      data: { code: 'LAST_OWNER', detail: 'This is the only active owner.' },
      status: 409,
    })
    const { toast } = await import('sonner')

    await renderTeam()
    await waitFor(() => expect(rowFor('Camille Bérard')).toBeInTheDocument())
    await user.click(within(rowFor('Camille Bérard')).getByRole('button', { name: /^deactivate/i }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'That is the only active owner.',
        expect.objectContaining({
          description: expect.stringContaining('A business must always have one active owner'),
        }),
      ),
    )
  })
})

describe('inviting', () => {
  it('sends the three fields and then explains what happens next', async () => {
    const user = userEvent.setup()
    writeAnswer = () => ({ data: SAM, status: 201 })

    await renderTeam()
    await waitFor(() => expect(rowFor('Camille Bérard')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /invite colleague/i }))
    await user.type(await screen.findByLabelText('Full name'), 'Sam Ferreira')
    await user.type(screen.getByLabelText('Email address'), 'sam@example.com')
    await user.click(screen.getByRole('button', { name: /send invitation/i }))

    await waitFor(() => expect(writes('post').length).toBe(1))
    expect(JSON.parse(String(writes('post')[0]?.data))).toEqual({
      fullName: 'Sam Ferreira',
      email: 'sam@example.com',
      role: 'STAFF',
    })

    // In words: a link, seven days, they choose their own password. The dialog
    // stays open because the result happened in somebody else's inbox.
    expect(await screen.findByText('Invitation sent')).toBeInTheDocument()
    // Scoped to the dialog: the invited row behind it explains the seven days
    // too, which is the point of both sentences existing.
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/seven days/)).toBeInTheDocument()
    expect(within(dialog).getByText(/choose their own password/i)).toBeInTheDocument()
    expect(within(dialog).getByText('sam@example.com')).toBeInTheDocument()
  })

  it('gives 409 EMAIL_TAKEN its own copy, on the email field', async () => {
    const user = userEvent.setup()
    writeAnswer = () => ({
      data: { code: 'EMAIL_TAKEN', detail: 'That email address already has an account.' },
      status: 409,
    })

    await renderTeam()
    await waitFor(() => expect(rowFor('Camille Bérard')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /invite colleague/i }))
    await user.type(await screen.findByLabelText('Full name'), 'Sam Ferreira')
    await user.type(screen.getByLabelText('Email address'), 'amelie@slotflow.app')
    await user.click(screen.getByRole('button', { name: /send invitation/i }))

    // Not "conflict": one person can only belong to one business in v1 (D13),
    // and an owner needs to be told that rather than left retrying.
    expect(
      await screen.findByText(/One person can only belong to one business/i),
    ).toBeInTheDocument()
  })

  it('resends from the row and says the earlier link is dead', async () => {
    const user = userEvent.setup()
    writeAnswer = () => ({ data: SAM, status: 200 })
    const { toast } = await import('sonner')

    await renderTeam()
    await waitFor(() => expect(rowFor('Sam Ferreira')).toBeInTheDocument())

    await user.click(
      within(rowFor('Sam Ferreira')).getByRole('button', { name: /resend invitation/i }),
    )

    await waitFor(() => expect(writes('post')[0]?.url).toBe(`/api/staff/${SAM.id}/invite/resend`))
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining('sam@example.com'),
      expect.objectContaining({
        description: expect.stringContaining('no longer works'),
      }),
    )
  })
})

describe('what a mutation invalidates', () => {
  it('refetches the roster the calendar resolves its names from', async () => {
    const user = userEvent.setup()
    writeAnswer = () => ({ data: { staff: { ...AMELIE, active: false } }, status: 200 })

    await renderTeam()
    await waitFor(() => expect(rowFor('Amélie Rousseau')).toBeInTheDocument())
    const before = teamReads().length

    await user.click(
      within(rowFor('Amélie Rousseau')).getByRole('button', { name: /^deactivate/i }),
    )

    await waitFor(() => expect(teamReads().length).toBeGreaterThan(before))
  })

  it('invalidates the services list too, because bookability moved', async () => {
    // The wave's subtlest watch-out. Deactivating somebody flips
    // `bookable: false` on every service they were the only performer of, and a
    // catalogue left cached would keep saying Bookable about a service that now
    // offers nothing — the exact silence this wave exists to remove.
    const user = userEvent.setup()
    writeAnswer = () => ({ data: { staff: { ...AMELIE, active: false } }, status: 200 })

    stubApi()
    const { queryClient } = mount('/team')
    await waitFor(() =>
      expect(screen.queryByText('Restoring your session')).not.toBeInTheDocument(),
    )
    await waitFor(() => expect(rowFor('Amélie Rousseau')).toBeInTheDocument())

    // The catalogue screen's own cache entry, as it would be after a visit.
    const key = serviceKeys.list({ active: true, page: 0, size: 20 })
    queryClient.setQueryData(key, {
      content: [SERVICE],
      page: 0,
      size: 20,
      totalElements: 1,
      totalPages: 1,
    })
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)

    await user.click(
      within(rowFor('Amélie Rousseau')).getByRole('button', { name: /^deactivate/i }),
    )

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true))
  })
})

describe('the three states of the list', () => {
  it('holds the geometry of the roster while it loads', async () => {
    stubApi()
    mount('/team')
    expect(await screen.findByText('Loading your team')).toBeInTheDocument()
  })

  it('offers a retry when the roster fails', async () => {
    teamStatus = 500
    const user = userEvent.setup()
    await renderTeam()

    // `shouldRetry` allows two retries for a 5xx, with backoff.
    expect(
      await screen.findByText('Your team could not be loaded', undefined, { timeout: 10_000 }),
    ).toBeInTheDocument()

    teamStatus = 200
    const retry = screen.getAllByRole('button', { name: 'Try again' }).at(0)
    if (!retry) throw new Error('no retry button')
    await user.click(retry)
    await waitFor(() => expect(rowFor('Camille Bérard')).toBeInTheDocument())
  })

  it('invites from the empty state', async () => {
    team = []
    const user = userEvent.setup()
    await renderTeam()

    expect(await screen.findByText('Nobody here yet')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: /invite colleague/i })
    const inEmptyState = buttons.at(-1)
    if (!inEmptyState) throw new Error('no Invite colleague button')
    await user.click(inEmptyState)
    expect(await screen.findByLabelText('Full name')).toBeInTheDocument()
  })
})

describe('who may see this screen', () => {
  it('redirects a staff session away from /team', async () => {
    // Demo step 10, the other half.
    session = STAFF_SESSION
    const { router } = await renderTeam('/team')

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
  })
})

describe('axe', () => {
  /** `color-contrast` off and only that rule — jsdom cannot run it. */
  const options = { rules: { 'color-contrast': { enabled: false } } } as const

  it('reports nothing with all four states and the warning on screen', async () => {
    const user = userEvent.setup()
    writeAnswer = () => ({
      data: { staff: { ...AMELIE, active: false }, warning: WARNING },
      status: 200,
    })

    await renderTeam()
    await waitFor(() => expect(rowFor('Amélie Rousseau')).toBeInTheDocument())
    await user.click(
      within(rowFor('Amélie Rousseau')).getByRole('button', { name: /^deactivate/i }),
    )
    await screen.findByRole('alert')

    const main = document.querySelector('main')
    if (!main) throw new Error('no main')
    const result = await axe.run(main, options)
    expect(result.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
  })

  it('reports nothing on the invitation dialog', async () => {
    const user = userEvent.setup()
    await renderTeam()
    await waitFor(() => expect(rowFor('Camille Bérard')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /invite colleague/i }))
    const dialog = await screen.findByRole('dialog')

    const result = await axe.run(dialog, options)
    expect(result.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
  })
})
