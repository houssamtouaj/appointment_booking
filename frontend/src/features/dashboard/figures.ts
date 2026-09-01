import { formatMoney } from '@/lib/money'
import type { DashboardStats } from '@/types'

/**
 * Every number on the dashboard, with the sentence that says what it counts.
 *
 * **The definitions are the deliverable here as much as the figures are**, and
 * they live in one table rather than in the markup because two of them are
 * claims about money that have to be worded once and worded carefully:
 *
 * - **"Revenue earned", never "Revenue."** The server sums `price_cents` over
 *   `COMPLETED` only. An appointment confirmed for next Thursday is not in that
 *   number, and a tile labelled "Revenue" beside a week's worth of confirmed
 *   bookings invites an owner to read it as the week's takings and conclude the
 *   software is wrong. The backend went to the trouble of distinguishing booked
 *   from earned; throwing that away in a label is the last-step version of the
 *   bug it avoided.
 * - **"Deposits held" is deliberately not a subset of revenue.** It is money
 *   that has arrived against work not yet done. Both numbers are real and
 *   neither contains the other, which is exactly why both are shown.
 *
 * The third careful one is `noShowRate`, and it is careful by being allowed to
 * say nothing at all — see {@link NOT_ENOUGH_DATA}.
 */

/**
 * What `noShowRate: null` renders as.
 *
 * A business with nothing completed has no no-show rate. Printing "0%" tells an
 * owner they have a perfect record when what they have is no data, and the API
 * is `@JsonInclude(ALWAYS)`-annotated precisely so a client can tell the two
 * apart. Reintroducing the zero at the last step would waste that.
 */
export const NOT_ENOUGH_DATA = 'Not enough data'

/**
 * `value` sets in the display face and reads as a number; `absent` sets in body
 * copy and reads as a sentence, because it is one.
 */
export type FigureValue = { text: string; kind: 'value' | 'absent' }

export type Figure = {
  key: keyof DashboardStats
  label: string
  /** One sentence, always on screen — including while the number is still loading. */
  definition: string
  format: (stats: DashboardStats, currency: string, locale?: string) => FigureValue
}

export const FIGURES: readonly Figure[] = [
  {
    key: 'todayBookings',
    label: 'Today',
    // The one figure the week picker does not move. Saying so here is cheaper
    // than the support question that follows from paging back a fortnight and
    // watching four numbers change and one refuse to.
    definition: 'Confirmed appointments starting today, whichever week is shown.',
    format: (stats, _currency, locale) => count(stats.todayBookings, locale),
  },
  {
    key: 'weekBookings',
    // Not "Appointments this week": the picker moves, and a label that names the
    // current week while showing a fortnight ago is a small lie told on every
    // other screenful. The range is stated in full directly above these tiles.
    label: 'Appointments',
    definition: 'Confirmed and completed in the week shown. Cancellations never count.',
    format: (stats, _currency, locale) => count(stats.weekBookings, locale),
  },
  {
    key: 'revenueCents',
    label: 'Revenue earned',
    definition: 'Completed appointments only. An appointment still to come has not earned yet.',
    format: (stats, currency, locale) => money(stats.revenueCents, currency, locale),
  },
  {
    key: 'depositsCents',
    label: 'Deposits held',
    definition: 'Paid on appointments in the week that were not cancelled, including future ones.',
    format: (stats, currency, locale) => money(stats.depositsCents, currency, locale),
  },
  {
    key: 'noShowRate',
    label: 'No-shows',
    definition: 'Missed appointments as a share of the ones that have finished.',
    format: (stats, _currency, locale) =>
      stats.noShowRate === null
        ? { text: NOT_ENOUGH_DATA, kind: 'absent' }
        : { text: percent(stats.noShowRate, locale), kind: 'value' },
  },
]

function count(value: number, locale?: string): FigureValue {
  return { text: value.toLocaleString(locale), kind: 'value' }
}

/**
 * `me.business.currency` is the currency for every `*Cents` on this screen — a
 * property of the tenant, never of the viewer and never hard-coded. It types as
 * `object` in the OpenAPI document and is the string `"EUR"` on the wire (F3).
 */
function money(minorUnits: number, currency: string, locale?: string): FigureValue {
  return { text: formatMoney(minorUnits, currency, locale), kind: 'value' }
}

/**
 * `0.043` becomes `"4.3%"`.
 *
 * One decimal place, because the server sends four and a dashboard that renders
 * `4.2553%` is claiming a precision that two integers and a division do not
 * have. `Intl` rather than `* 100`, so the separator follows the reader's locale
 * the way every other number on the screen does.
 *
 * Cached, for the reason `lib/money.ts` gives — construction is the expensive
 * half of formatting — and for a smaller one: this file agreeing with its two
 * neighbours matters more here than the cost does. One figure per render makes
 * that cost negligible, and a reader who has just seen `money.ts` and `time.ts`
 * both keep their formatters should not have to work out why this one does not.
 * Keyed by locale because `undefined` means "the browser's".
 */
const formatters = new Map<string, Intl.NumberFormat>()

function percent(rate: number, locale?: string): string {
  const key = locale ?? ''
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })
    formatters.set(key, formatter)
  }
  return formatter.format(rate)
}
