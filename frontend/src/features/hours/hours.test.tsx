import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios'
import axe from 'axe-core'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
 * The working-hours screen, and the four things about it that are worth a test
 * rather than a screenshot.
 *
 * - **The `PUT` is a replace.** Everything about this screen follows from that,
 *   and the failure mode is silent: a body that omits a day deletes it, the
 *   request succeeds, and the loss surfaces a week later. So both halves are
 *   asserted — the body carries the whole week, and the UI names the day it is
 *   about to empty *before* sending.
 * - **`422 HOURS_OVERLAP` on a body the client check passed.** The client's
 *   overlap rule is a mirror of the server's, and a mirror can be wrong. The
 *   handler has to survive the case where it is, which is why the stub refuses a
 *   week this screen was happy to send.
 * - **The unsaved-changes guard**, on a route change and on tab close. Neither
 *   mechanism covers the other.
 * - **Self-only.** A staff member edits their own hours and nobody else's, and
 *   the screen says so rather than letting them walk into a 403.
 */

const TZ = 'Europe/Paris'

const AMELIE = {
  id: '33333333-3333-3333-3333-333333333333',
  email: 'amelie@slotflow.app',
  fullName: 'Amélie Rousseau',
  role: 'STAFF' as 'OWNER' | 'STAFF',
  active: true,
  accepted: true,
  invitationPending: false,
  serviceIds: [] as string[],
}

const CAMILLE = {
  ...AMELIE,
  id: '55555555-5555-5555-5555-555555555555',
  email: 'demo@slotflow.app',
  fullName: 'Camille Bérard',
  role: 'OWNER' as 'OWNER' | 'STAFF',
}

const OWNER_SESSION = {
  id: CAMILLE.id,
  email: CAMILLE.email,
  fullName: CAMILLE.fullName,
  role: 'OWNER' as 'OWNER' | 'STAFF',
  business: {
    id: '66666666-6666-6666-6666-666666666666',
    slug: 'demo-salon',
    name: 'Belle Époque',
    timezone: TZ,
    currency: 'EUR',
  },
}

const STAFF_SESSION = {
  ...OWNER_SESSION,
  id: AMELIE.id,
  email: AMELIE.email,
  fullName: AMELIE.fullName,
  role: 'STAFF' as const,
}

/** A split Monday and a plain Saturday — the two shapes the gate asks about. */
const SAVED_RANGES = [
  { dayOfWeek: 'MONDAY', startTime: '09:00:00', endTime: '12:00:00' },
  { dayOfWeek: 'MONDAY', startTime: '14:00:00', endTime: '18:00:00' },
  { dayOfWeek: 'SATURDAY', startTime: '10:00:00', endTime: '14:00:00' },
]

const WHOLE_DAY_CLOSURE = {
  id: 'cccccccc-0000-4000-8000-000000000001',
  businessWide: true,
  date: '2026-12-25',
  wholeDay: true,
  type: 'BLOCKED',
  reason: 'Public holiday',
}

const PERSONAL_EXTRA = {
  id: 'cccccccc-0000-4000-8000-000000000002',
  staffId: AMELIE.id,
  businessWide: false,
  date: '2026-12-17',
  startTime: '18:00:00',
  endTime: '21:00:00',
  wholeDay: false,
  type: 'EXTRA',
  reason: 'Late opening',
}

/** Somebody else's day off. The panel is headed with one name and must not list it. */
const SOMEONE_ELSES = {
  ...PERSONAL_EXTRA,
  id: 'cccccccc-0000-4000-8000-000000000003',
  staffId: CAMILLE.id,
  type: 'BLOCKED',
  reason: 'Marc is away',
}

// --- the stub API ----------------------------------------------------------

let session = OWNER_SESSION
let ranges = SAVED_RANGES
let overrides: unknown[] = []
let requests: AxiosRequestConfig[] = []
let hoursStatus = 200
let putAnswer: ((config: AxiosRequestConfig) => { data: unknown; status: number }) | undefined
/**
 * A `POST /api/exceptions` that actually returns the row it created.
 *
 * The default below answers every non-GET with a bodiless 204, which the create
 * mutation rejects — `overrideSchema.parse(null)` throws — so a test that needs
 * the *success* path, and the invalidation that hangs off it, has to say so.
 */
let postAnswer: ((config: AxiosRequestConfig) => { data: unknown; status: number }) | undefined

function callsTo(method: string, path: string): AxiosRequestConfig[] {
  return requests.filter(
    (config) =>
      (config.method ?? 'get').toLowerCase() === method && (config.url ?? '').includes(path),
  )
}

function lastPutBody(): { ranges: { dayOfWeek: string; startTime: string; endTime: string }[] } {
  const calls = callsTo('put', '/working-hours')
  const body = calls[calls.length - 1]?.data
  return JSON.parse(typeof body === 'string' ? body : JSON.stringify(body ?? {}))
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
    } else if (method === 'put' && url.includes('/working-hours')) {
      const answer = putAnswer?.(config)
      if (answer) {
        data = answer.data
        status = answer.status
      } else {
        const sent = JSON.parse(String(config.data)) as { ranges: typeof SAVED_RANGES }
        ranges = sent.ranges
        data = { staffId: AMELIE.id, ranges }
      }
    } else if (method === 'post' && url.includes('exceptions') && postAnswer) {
      const answer = postAnswer(config)
      data = answer.data
      status = answer.status
    } else if (method !== 'get') {
      status = 204
    } else if (url.includes('/working-hours')) {
      if (hoursStatus >= 400) {
        status = hoursStatus
        data = { code: 'ACCESS_DENIED', detail: 'Not yours.' }
      } else {
        data = { staffId: AMELIE.id, ranges }
      }
    } else if (url === '/api/exceptions') {
      data = overrides
    } else if (url === '/api/staff') {
      data = [CAMILLE, AMELIE]
    } else if (url.startsWith('/api/services')) {
      data = { content: [], page: 0, size: 100, totalElements: 0, totalPages: 0 }
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

async function renderHours(path = `/team/${AMELIE.id}/hours`) {
  stubApi()
  const mounted = mount(path)
  await waitFor(() => expect(screen.queryByText('Restoring your session')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.getByLabelText('Monday, shift 1 start')).toBeInTheDocument())
  return mounted
}

function timeInput(name: string): HTMLInputElement {
  return screen.getByLabelText(name) as HTMLInputElement
}

/**
 * The header's CTA. The empty state repeats it on purpose — the action belongs
 * where somebody looking at an empty month is actually looking — so this names
 * the first of the two rather than asserting there is only one.
 */
function addOverrideButton(): HTMLElement {
  const [first] = screen.getAllByRole('button', { name: /add an override/i })
  if (!first) throw new Error('no add-an-override button')
  return first
}

beforeEach(() => {
  session = OWNER_SESSION
  ranges = SAVED_RANGES
  overrides = []
  requests = []
  hoursStatus = 200
  putAnswer = undefined
  postAnswer = undefined
})

afterEach(() => {
  vi.clearAllMocks()
  endSessionQuietly()
  resetBootstrap()
  resetInFlightRefresh()
  client.defaults.adapter = undefined
})

describe('the weekly grid', () => {
  it('draws seven rows, a split Monday among them, and closed days as closed', async () => {
    await renderHours()

    expect(timeInput('Monday, shift 1 start').value).toBe('09:00')
    expect(timeInput('Monday, shift 2 start').value).toBe('14:00')
    expect(timeInput('Saturday, shift 1 start').value).toBe('10:00')
    // Sunday has no hours in the fixture and is a row that says so, not a gap.
    expect(screen.getAllByText('Closed — no hours worked').length).toBeGreaterThan(0)
  })

  it('says, before anything is pressed, that saving replaces the whole week', async () => {
    await renderHours()

    expect(screen.getByText(/saving replaces the whole week/i)).toBeInTheDocument()
  })

  /**
   * The gate item. Three ranges on one day have to survive the round trip, and
   * the body has to carry every other day with them.
   */
  it('sends the whole week, including a third shift added to one day', async () => {
    const user = userEvent.setup()
    await renderHours()

    const monday = screen.getByLabelText('Monday').closest('li') as HTMLElement
    await user.click(within(monday).getByRole('button', { name: /add a shift/i }))
    await user.click(screen.getByRole('button', { name: 'Save the week' }))

    await waitFor(() => expect(callsTo('put', '/working-hours')).toHaveLength(1))
    const sent = lastPutBody().ranges
    expect(sent.filter((range) => range.dayOfWeek === 'MONDAY')).toHaveLength(3)
    expect(sent.filter((range) => range.dayOfWeek === 'SATURDAY')).toHaveLength(1)
    expect(sent[0]?.startTime).toBe('09:00:00')
  })

  it('keeps the split shift after a save and reload of the query', async () => {
    const user = userEvent.setup()
    await renderHours()

    fireEvent.change(timeInput('Monday, shift 2 end'), { target: { value: '19:00' } })
    await user.click(screen.getByRole('button', { name: 'Save the week' }))

    await waitFor(() => expect(timeInput('Monday, shift 2 end').value).toBe('19:00'))
    expect(timeInput('Monday, shift 1 start').value).toBe('09:00')
  })

  /**
   * Two halves of one gate item: the day is really removed from the body, and
   * the person was told which day before it happened.
   */
  it('names the day a save is about to empty, and only then omits it', async () => {
    const user = userEvent.setup()
    await renderHours()

    await user.click(screen.getByLabelText('Saturday'))
    await user.click(screen.getByRole('button', { name: 'Save the week' }))

    // Nothing has been sent yet — the dialog is the "made that obvious first".
    expect(callsTo('put', '/working-hours')).toHaveLength(0)
    expect(await screen.findByText(/Saturday will no longer be worked/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save and remove' }))

    await waitFor(() => expect(callsTo('put', '/working-hours')).toHaveLength(1))
    expect(lastPutBody().ranges.some((range) => range.dayOfWeek === 'SATURDAY')).toBe(false)
  })

  it('asks nothing when the save removes no day that had hours', async () => {
    const user = userEvent.setup()
    await renderHours()

    fireEvent.change(timeInput('Monday, shift 1 end'), { target: { value: '11:00' } })
    await user.click(screen.getByRole('button', { name: 'Save the week' }))

    await waitFor(() => expect(callsTo('put', '/working-hours')).toHaveLength(1))
    expect(screen.queryByText(/will no longer be worked/i)).toBeNull()
  })

  it('refuses to send an overlap it can see, and marks the row', async () => {
    await renderHours()

    // 14:00–18:00 now starts inside 09:00–12:30.
    fireEvent.change(timeInput('Monday, shift 2 start'), { target: { value: '11:00' } })

    expect(await screen.findByText(/these hours overlap something else/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save the week' })).toBeDisabled()
    expect(callsTo('put', '/working-hours')).toHaveLength(0)
  })

  /**
   * The client check is an affordance; the server's is the rule. This is the
   * case where the two disagree — the body passed here and is refused there —
   * and the screen still has to say something useful and mark the right row.
   */
  it('handles 422 HOURS_OVERLAP on a week its own check was happy with', async () => {
    const user = userEvent.setup()
    putAnswer = () => ({
      status: 422,
      data: {
        code: 'HOURS_OVERLAP',
        detail: 'Two ranges overlap on Monday.',
        dayOfWeek: 'MONDAY',
      },
    })
    await renderHours()

    fireEvent.change(timeInput('Monday, shift 1 end'), { target: { value: '11:00' } })
    await user.click(screen.getByRole('button', { name: 'Save the week' }))

    await waitFor(() => expect(callsTo('put', '/working-hours')).toHaveLength(1))
    // The server named Monday; the grid marks Monday, not the whole form.
    expect(await screen.findByText(/these hours overlap something else/i)).toBeInTheDocument()
    expect(timeInput('Monday, shift 1 start')).toHaveAttribute('aria-invalid', 'true')
    expect(timeInput('Saturday, shift 1 start')).toHaveAttribute('aria-invalid', 'false')
  })

  it('will not offer a save for a range whose start equals its end', async () => {
    await renderHours()

    fireEvent.change(timeInput('Monday, shift 1 end'), { target: { value: '09:00' } })

    expect(await screen.findByText('Start and end must differ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save the week' })).toBeDisabled()
  })
})

describe('the unsaved-changes guard', () => {
  it('blocks a route change and lets the person stay', async () => {
    const user = userEvent.setup()
    const { router } = await renderHours()

    fireEvent.change(timeInput('Monday, shift 1 end'), { target: { value: '13:00' } })
    await user.click(screen.getByRole('link', { name: /dashboard/i }))

    expect(await screen.findByText(/leave without saving these hours/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))

    await waitFor(() => expect(router.state.location.pathname).toContain('/hours'))
  })

  it('lets it through once the person says to discard', async () => {
    const user = userEvent.setup()
    const { router } = await renderHours()

    fireEvent.change(timeInput('Monday, shift 1 end'), { target: { value: '13:00' } })
    await user.click(screen.getByRole('link', { name: /dashboard/i }))
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
  })

  it('does not block a navigation when nothing has been edited', async () => {
    const user = userEvent.setup()
    const { router } = await renderHours()

    await user.click(screen.getByRole('link', { name: /dashboard/i }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
  })

  /**
   * A route change stays inside the SPA and never fires `beforeunload`; a tab
   * close never reaches the router. Both exits, or the guard covers one of two.
   */
  it('registers a beforeunload handler only while there are edits', async () => {
    const add = vi.spyOn(window, 'addEventListener')
    await renderHours()

    expect(add.mock.calls.some(([event]) => event === 'beforeunload')).toBe(false)

    fireEvent.change(timeInput('Monday, shift 1 end'), { target: { value: '13:00' } })

    await waitFor(() =>
      expect(add.mock.calls.some(([event]) => event === 'beforeunload')).toBe(true),
    )
    add.mockRestore()
  })
})

describe('one-off overrides', () => {
  it('renders a whole-day closure and a timed extra as different things', async () => {
    overrides = [WHOLE_DAY_CLOSURE, PERSONAL_EXTRA]
    await renderHours()

    const closure = await screen.findByText('Public holiday', { exact: false })
    const closureRow = closure.closest('li')
    expect(closureRow).not.toBeNull()
    expect(within(closureRow as HTMLElement).getByText(/closed all day/i)).toBeInTheDocument()
    expect(within(closureRow as HTMLElement).getByText('Whole business')).toBeInTheDocument()

    const extraRow = screen.getByText(/Late opening/).closest('li')
    expect(within(extraRow as HTMLElement).getByText(/18:00 – 21:00/)).toBeInTheDocument()
    expect(within(extraRow as HTMLElement).queryByText('Whole business')).toBeNull()
  })

  it('leaves a colleague’s own override off a page headed with one name', async () => {
    overrides = [PERSONAL_EXTRA, SOMEONE_ELSES]
    await renderHours()

    await screen.findByText(/Late opening/)
    expect(screen.queryByText(/Marc is away/)).toBeNull()
  })

  it('asks the API for the month it is showing, never for an unbounded range', async () => {
    await renderHours()

    const [call] = callsTo('get', '/api/exceptions')
    expect(call?.params).toEqual(
      expect.objectContaining({
        from: expect.stringMatching(/^\d{4}-\d{2}-01$/),
        to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
  })

  it('never offers a whole-day EXTRA, because it means nothing', async () => {
    const user = userEvent.setup()
    await renderHours()

    await user.click(addOverrideButton())
    expect(await screen.findByLabelText('The whole day')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Effect'), 'EXTRA')

    expect(screen.queryByLabelText('The whole day')).toBeNull()
    expect(screen.getByLabelText('From')).toBeInTheDocument()
    expect(screen.getByLabelText('To')).toBeInTheDocument()
  })

  it('will not let a business-wide closure be an EXTRA', async () => {
    const user = userEvent.setup()
    await renderHours()

    await user.click(addOverrideButton())
    await user.selectOptions(await screen.findByLabelText('Applies to'), 'business')

    const effect = screen.getByLabelText('Effect') as HTMLSelectElement
    expect(effect).toBeDisabled()
    expect(within(effect).queryByRole('option', { name: /extra/i })).toBeNull()
  })

  it('refetches the overrides but not the weekly template it sits beside', async () => {
    postAnswer = () => ({
      data: { ...WHOLE_DAY_CLOSURE, date: '2026-12-25', reason: 'Christmas' },
      status: 201,
    })
    const user = userEvent.setup()
    await renderHours()
    await screen.findByLabelText('Monday, shift 1 start')

    const templateReadsBefore = callsTo('get', `/api/staff/${AMELIE.id}/working-hours`).length
    const overrideReadsBefore = callsTo('get', '/api/exceptions').length

    await user.click(addOverrideButton())
    fireEvent.change(await screen.findByLabelText('Date'), { target: { value: '2026-12-25' } })
    await user.type(screen.getByLabelText('Reason'), 'Christmas')
    await user.selectOptions(screen.getByLabelText('Applies to'), 'business')
    await user.click(screen.getByRole('button', { name: 'Add it' }))

    await waitFor(() => expect(callsTo('post', '/api/exceptions')).toHaveLength(1))
    await waitFor(() =>
      expect(callsTo('get', '/api/exceptions').length).toBeGreaterThan(overrideReadsBefore),
    )

    // The grid on this page holds a draft seeded on mount and never
    // resynchronised, deliberately. An override does not change the weekly
    // template, so a refetch of it here would be a refetch behind unsaved edits
    // for no reason — which is what invalidating the whole `availability`
    // namespace used to do, `all` being a prefix of `hours(staffId)`.
    expect(callsTo('get', `/api/staff/${AMELIE.id}/working-hours`)).toHaveLength(
      templateReadsBefore,
    )
  })

  it('posts a whole-day closure to the business path with no times on it', async () => {
    const user = userEvent.setup()
    await renderHours()

    await user.click(addOverrideButton())
    fireEvent.change(await screen.findByLabelText('Date'), { target: { value: '2026-12-25' } })
    await user.type(screen.getByLabelText('Reason'), 'Christmas')
    await user.selectOptions(screen.getByLabelText('Applies to'), 'business')
    await user.click(screen.getByRole('button', { name: 'Add it' }))

    await waitFor(() => expect(callsTo('post', '/api/exceptions')).toHaveLength(1))
    const body = JSON.parse(String(callsTo('post', '/api/exceptions')[0]?.data))
    expect(body).toEqual({ date: '2026-12-25', type: 'BLOCKED', reason: 'Christmas' })
    expect(body).not.toHaveProperty('startTime')
    // The scope is the path, never a field on the body.
    expect(body).not.toHaveProperty('staffId')
  })

  it('posts a personal override under the staff member’s own path', async () => {
    const user = userEvent.setup()
    await renderHours()

    await user.click(addOverrideButton())
    fireEvent.change(await screen.findByLabelText('Date'), { target: { value: '2026-12-17' } })
    await user.selectOptions(screen.getByLabelText('Effect'), 'EXTRA')
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '18:00' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '21:00' } })
    await user.click(screen.getByRole('button', { name: 'Add it' }))

    await waitFor(() =>
      expect(callsTo('post', `/api/staff/${AMELIE.id}/exceptions`)).toHaveLength(1),
    )
    const body = JSON.parse(String(callsTo('post', `/api/staff/${AMELIE.id}/exceptions`)[0]?.data))
    expect(body).toMatchObject({ type: 'EXTRA', startTime: '18:00:00', endTime: '21:00:00' })
  })
})

describe('who may edit whose hours', () => {
  it('lets a staff member edit their own', async () => {
    session = STAFF_SESSION
    await renderHours(`/team/${AMELIE.id}/hours`)

    expect(screen.getByRole('heading', { name: 'Your working hours' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save the week' })).toBeInTheDocument()
  })

  it('sends a staff member who asks for a colleague back to their own hours', async () => {
    session = STAFF_SESSION
    stubApi()
    const { router } = mount(`/team/${CAMILLE.id}/hours`)

    await waitFor(() => expect(router.state.location.pathname).toBe(`/team/${AMELIE.id}/hours`))
    // And it never asked the API for the colleague's template.
    expect(callsTo('get', `/api/staff/${CAMILLE.id}/working-hours`)).toHaveLength(0)
  })

  it('hides the business-wide option from a staff member', async () => {
    const user = userEvent.setup()
    session = STAFF_SESSION
    await renderHours()

    await user.click(addOverrideButton())
    await screen.findByLabelText('Date')

    expect(screen.queryByLabelText('Applies to')).toBeNull()
  })

  it('shows a staff member the closure they cannot lift, and says who set it', async () => {
    session = STAFF_SESSION
    overrides = [WHOLE_DAY_CLOSURE]
    await renderHours()

    const row = (await screen.findByText(/Public holiday/)).closest('li')
    expect(within(row as HTMLElement).getByText('Set by an owner')).toBeInTheDocument()
    expect(within(row as HTMLElement).queryByRole('button', { name: /remove/i })).toBeNull()
  })

  it('lets an owner edit a colleague, headed with their name', async () => {
    await renderHours(`/team/${AMELIE.id}/hours`)

    expect(
      screen.getByRole('heading', { name: 'Amélie Rousseau’s working hours' }),
    ).toBeInTheDocument()
  })
})

describe('when the template cannot be read', () => {
  it('says so with a retry rather than an empty grid', async () => {
    hoursStatus = 403
    stubApi()
    mount(`/team/${AMELIE.id}/hours`)

    expect(await screen.findByText('These working hours could not be loaded')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('axe', () => {
  /** `color-contrast` off and only that rule — jsdom cannot run it. */
  const options = { rules: { 'color-contrast': { enabled: false } } } as const

  it('reports nothing on the grid, the overrides and a marked overlap', async () => {
    overrides = [WHOLE_DAY_CLOSURE, PERSONAL_EXTRA]
    await renderHours()
    await screen.findByText(/Late opening/)

    // With a row in its error state, which is the version of this screen most
    // likely to have an unlabelled control or an alert nothing points at.
    fireEvent.change(timeInput('Monday, shift 2 start'), { target: { value: '11:00' } })
    await screen.findByText(/these hours overlap something else/i)

    const main = document.querySelector('main')
    if (!main) throw new Error('no main')
    const result = await axe.run(main, options)
    expect(result.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
  })

  it('reports nothing on the override dialog', async () => {
    const user = userEvent.setup()
    await renderHours()

    await user.click(addOverrideButton())
    const dialog = await screen.findByRole('dialog')

    const result = await axe.run(dialog, options)
    expect(result.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
  })
})
