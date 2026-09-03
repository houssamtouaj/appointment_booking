import { currentLocale, type TKey } from '@/i18n'
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
 *
 * A key rather than the sentence, like every other string in this table: the
 * band translates it at render.
 */
export const NOT_ENOUGH_DATA: TKey = 'dashboard.figures.notEnoughData'

/**
 * `value` sets in the display face and reads as a number; `absent` sets in body
 * copy and reads as a sentence, because it is one.
 *
 * A union rather than one shape with a `kind` flag, so the two halves can carry
 * different types: a formatted number is already a string in the reader's
 * locale, and the absent sentence is a dictionary key the band resolves. The
 * discriminant makes that a compiler-checked branch rather than a cast.
 */
export type FigureValue = { text: string; kind: 'value' } | { text: TKey; kind: 'absent' }

export type Figure = {
  key: keyof DashboardStats
  label: TKey
  /** One sentence, always on screen — including while the number is still loading. */
  definition: TKey
  /**
   * No `locale` parameter any more (F23). `formatMoney` and `Intl` below resolve
   * it from the language store, which is the same answer every other formatter
   * in the app now reaches — and one fewer thing for a caller to forget.
   */
  format: (stats: DashboardStats, currency: string) => FigureValue
}

export const FIGURES: readonly Figure[] = [
  {
    key: 'todayBookings',
    label: 'dashboard.figures.today',
    // The one figure the week picker does not move. Saying so here is cheaper
    // than the support question that follows from paging back a fortnight and
    // watching four numbers change and one refuse to.
    definition: 'dashboard.figures.todayDefinition',
    format: (stats) => count(stats.todayBookings),
  },
  {
    key: 'weekBookings',
    // Not "Appointments this week": the picker moves, and a label that names the
    // current week while showing a fortnight ago is a small lie told on every
    // other screenful. The range is stated in full directly above these tiles.
    label: 'dashboard.figures.bookings',
    definition: 'dashboard.figures.bookingsDefinition',
    format: (stats) => count(stats.weekBookings),
  },
  {
    key: 'revenueCents',
    label: 'dashboard.figures.revenue',
    definition: 'dashboard.figures.revenueDefinition',
    format: (stats, currency) => money(stats.revenueCents, currency),
  },
  {
    key: 'depositsCents',
    label: 'dashboard.figures.deposits',
    definition: 'dashboard.figures.depositsDefinition',
    format: (stats, currency) => money(stats.depositsCents, currency),
  },
  {
    key: 'noShowRate',
    label: 'dashboard.figures.noShows',
    definition: 'dashboard.figures.noShowsDefinition',
    format: (stats) =>
      stats.noShowRate === null
        ? { text: NOT_ENOUGH_DATA, kind: 'absent' }
        : { text: percent(stats.noShowRate), kind: 'value' },
  },
]

function count(value: number): FigureValue {
  return { text: value.toLocaleString(currentLocale()), kind: 'value' }
}

/**
 * `me.business.currency` is the currency for every `*Cents` on this screen — a
 * property of the tenant, never of the viewer and never hard-coded. It types as
 * `object` in the OpenAPI document and is the string `"EUR"` on the wire (F3).
 */
function money(minorUnits: number, currency: string): FigureValue {
  return { text: formatMoney(minorUnits, currency), kind: 'value' }
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
 * Keyed by locale because the language store's answer changes when somebody
 * switches, and both formatters then stay warm.
 */
const formatters = new Map<string, Intl.NumberFormat>()

function percent(rate: number): string {
  const locale = currentLocale()
  let formatter = formatters.get(locale)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })
    formatters.set(locale, formatter)
  }
  return formatter.format(rate)
}
