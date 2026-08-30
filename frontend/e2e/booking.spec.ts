import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * The headline flow, end to end, against a real database (F11).
 *
 * It exists to prove the one thing no fixture can: that the availability engine,
 * the exclusion constraint and four screens agree with each other. Every screen
 * detail — copy per error code, the five statuses, the polling schedule — is
 * asserted far more cheaply in Vitest, and a slower copy of any of it here would
 * be a second place to update and a first place to flake.
 *
 * Two rules the wave plan sets, and both are about the database being *shared*:
 *
 * **The slot comes from the API's response, never from a hard-coded time.** The
 * demo seed's engine walks its grid from each opening window, so the starts are
 * `:05`, `:10` and `:35` and they move as soon as anything else is booked. A
 * literal `10:00` in this file is a test that passes until the seed changes.
 *
 * **It cleans up after itself, and it picks a slot nothing else wants.** The
 * seeded database is reused between runs — the gate asks for two passes in a row
 * — so this books the *last* slot of a day four weeks out and cancels it again.
 * The last slot of a distant day is the one a human demo is least likely to have
 * taken, and cancelling frees it the instant the DELETE commits.
 */

const SLUG = process.env.E2E_SLUG ?? 'demo-salon'
const API = process.env.VITE_API_BASE_URL ?? 'http://localhost:8081'

/** Must match `use.locale` in `playwright.config.ts` — see the chip locator below. */
const LOCALE = 'en-GB'

type Slot = { start: string; end: string; staffIds: string[] }
type Business = {
  timezone: string
  services: { id: string; name: string; durationMinutes: number }[]
}

/** `yyyy-MM-dd` for an instant, in the business's zone — the same rule the app follows. */
function dayKeyOf(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant))
  return parts
}

function addDays(dayKey: string, days: number): string {
  const date = new Date(`${dayKey}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** The Monday on or before `dayKey`; the picker fetches a week at a time. */
function mondayOf(dayKey: string): string {
  const weekday = new Date(`${dayKey}T12:00:00Z`).getUTCDay()
  return addDays(dayKey, -((weekday + 6) % 7))
}

async function availability(
  request: APIRequestContext,
  serviceId: string,
  timeZone: string,
  monday: string,
): Promise<Slot[]> {
  const response = await request.get(`${API}/api/public/businesses/${SLUG}/availability`, {
    params: { serviceId, from: monday, to: addDays(monday, 6), tz: timeZone },
  })
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as Slot[]
}

test('a stranger books a slot, is confirmed, and cancels it again', async ({ page, request }) => {
  // ---------------------------------------------------------------------
  //  Choose the target from the API, before touching the browser
  // ---------------------------------------------------------------------
  const businessResponse = await request.get(`${API}/api/public/businesses/${SLUG}`)
  expect(businessResponse.ok(), `no business at ${SLUG} — is the demo profile seeded?`).toBeTruthy()
  const business = (await businessResponse.json()) as Business
  const service = business.services.at(0)
  // A throw rather than an `expect`: `noUncheckedIndexedAccess` is on, and
  // everything below reads `service.id`. A matcher narrows nothing.
  if (!service) throw new Error(`${SLUG} has no active services — is the demo profile seeded?`)

  const timeZone = business.timezone
  const today = dayKeyOf(new Date().toISOString(), timeZone)
  const thisMonday = mondayOf(today)

  // Four weeks out, then forward a week at a time if that one happens to be
  // empty. Bounded, because past the business's maxAdvanceDays the answer is
  // empty for ever and a walk would spin.
  let weeksAhead = 4
  let slots: Slot[] = []
  let monday = ''
  for (; weeksAhead <= 8; weeksAhead += 1) {
    monday = addDays(thisMonday, weeksAhead * 7)
    slots = await availability(request, service.id, timeZone, monday)
    if (slots.length > 0) break
  }
  expect(slots.length, 'no availability four to eight weeks out').toBeGreaterThan(0)

  // The last slot of the last day that has any: the corner of the week a human
  // running the demo by hand is least likely to have taken.
  const byStart = [...slots].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  const target = byStart.at(-1)
  if (!target) throw new Error('the week reported slots and then had none')
  const targetDay = dayKeyOf(target.start, timeZone)
  const targetClock = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(target.start))

  // ---------------------------------------------------------------------
  //  Walk the flow the way a customer does
  // ---------------------------------------------------------------------
  await page.goto(`/b/${SLUG}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  await page
    .getByRole('link', { name: new RegExp(escapeRegExp(service.name)) })
    .first()
    .click()

  // Step 2 answers itself when exactly one person performs the service, so this
  // has to tolerate arriving at step 3 already — and it has to wait for the
  // roster before deciding which one it is on. A bare `isVisible()` on the
  // "Anyone" button answers `false` while the staff request is still in flight,
  // which is not "this step was skipped", it is "ask again in a moment".
  const chooseStaff = page.getByRole('heading', { level: 1, name: 'Who would you like?' })
  const chooseTime = page.getByRole('heading', { level: 1, name: 'When suits you?' })
  await expect(chooseStaff.or(chooseTime)).toBeVisible()
  if (await chooseStaff.isVisible()) {
    // "Anyone" omits staffId from the request entirely, which is what lets the
    // server assign the person with the lightest day.
    await page.getByRole('button', { name: /^Anyone/ }).click()
  }

  await expect(chooseTime).toBeVisible()

  /*
   * Forward one week at a time, the way the control is meant to be used —
   * **waiting for each step to land before taking the next**.
   *
   * "Next week" computes its destination from the week currently rendered, so
   * two clicks dispatched inside one frame both resolve to the same Monday and
   * one of them is spent for nothing. A person cannot click that fast; Playwright
   * can, and without this the picker arrives a week short of where the spec
   * thinks it is and fails on a locator instead of on the navigation.
   */
  for (let week = 1; week <= weeksAhead; week += 1) {
    const landing = addDays(thisMonday, week * 7)
    await page.getByRole('button', { name: 'Next week' }).click()
    await expect
      .poll(() => new URL(page.url()).searchParams.get('date'), {
        message: `the picker did not reach the week of ${landing}`,
      })
      .toBe(landing)
  }

  /*
   * The chip's whole accessible name: "12:15, Saturday 26 September".
   *
   * Named in full rather than matched on the clock alone, because a business
   * with steady opening hours offers the same start on every open day of the
   * week — so `/^12:15,/` matches six chips and Playwright refuses to act on an
   * ambiguous locator. The locale is pinned in `playwright.config.ts` so that
   * this string and the one the browser builds come from the same ICU data.
   */
  const dayHeading = new Date(`${targetDay}T12:00:00Z`).toLocaleDateString(LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
  const chip = page.getByRole('button', { name: `${targetClock}, ${dayHeading}`, exact: true })
  await expect(chip, `the picker did not offer ${targetClock} on ${targetDay}`).toBeVisible()
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Continue' }).click()

  // The start reached the URL exactly as the API sent it — no reformatting, no
  // rebuilding from a wall clock.
  //
  // Polled, like the week navigation above and for the same reason: the URL
  // change is a React state update, and a plain `expect` on `page.url()` reads
  // whatever the driver has a moment after the click rather than waiting for it.
  await expect
    .poll(() => new URL(page.url()).searchParams.get('slot'), {
      message: 'the chosen slot did not reach the URL',
    })
    .toBe(target.start)

  // ---------------------------------------------------------------------
  //  Details, and the write
  // ---------------------------------------------------------------------
  const guestEmail = `e2e-${Date.now()}@slotflow.test`
  await page.getByLabel('Your name').fill('Playwright Guest')
  await page.getByLabel('Email').fill(guestEmail)
  await page.getByRole('button', { name: 'Confirm booking' }).click()

  // Payments are off in this configuration, so the response is CONFIRMED with
  // nothing to pay — and the branch is on the response, not on any flag.
  await expect(page.getByRole('heading', { level: 1, name: 'You are booked' })).toBeVisible()

  const manageLink = page.getByRole('link', { name: 'Manage this booking' })
  const manageHref = await manageLink.getAttribute('href')
  const cancellationToken = manageHref?.split('/').pop() ?? ''
  expect(cancellationToken, 'no cancellation token on the confirmation').toMatch(/^[0-9a-f-]{36}$/i)
  // The credential is on screen as text, not only behind a button.
  await expect(
    page.getByText(`${new URL(page.url()).origin}/booking/${cancellationToken}`),
  ).toBeVisible()

  // The slot really is gone from the engine's answer, not merely from the cache.
  const afterBooking = await availability(request, service.id, timeZone, monday)
  expect(afterBooking.some((slot) => slot.start === target.start)).toBe(false)

  // ---------------------------------------------------------------------
  //  The manage page, and the cleanup that lets this run twice
  // ---------------------------------------------------------------------
  await manageLink.click()
  await expect(page.getByRole('heading', { level: 1, name: /confirmed/i })).toBeVisible()
  await expect(page.getByText(guestEmail)).toBeVisible()

  await cancelBooking(page)

  await expect(page.getByRole('heading', { level: 1, name: /cancelled/i })).toBeVisible()

  // Cancelling frees the slot the instant it commits: the exclusion
  // constraint's `WHERE status IN ('PENDING','CONFIRMED')` stops matching the
  // row, with no cleanup job in between. This assertion is both the last demo
  // step and the reason this spec can run twice against one seeded database.
  await expect(async () => {
    const afterCancel = await availability(request, service.id, timeZone, monday)
    expect(afterCancel.some((slot) => slot.start === target.start)).toBe(true)
  }).toPass()
})

async function cancelBooking(page: Page): Promise<void> {
  await page.getByRole('button', { name: /cancel this booking/i }).click()
  const dialog = page.getByRole('alertdialog')
  // Backend D7: the money sentence has to be on screen before the click, not
  // after it.
  await expect(dialog).toContainText('Deposits are not refunded.')
  await dialog.getByRole('button', { name: /yes, cancel it/i }).click()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
