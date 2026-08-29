/**
 * Minor units to something a customer can read (F3's sibling problem: the API
 * sends integers and the screen owes a person a price).
 *
 * Every price in this product crosses the wire as a `long` of minor units —
 * `priceCents`, `depositAmountCents` — and is turned into a decimal exactly
 * once, here. Six screens need it: the landing page, the three booking steps,
 * the manage page and the admin catalogue.
 *
 * **The divisor is the currency's, not 100.** The plan for this wave says
 * `cents / 100`, and that is right for EUR and wrong in a way that is invisible
 * until it is embarrassing. The backend's `notification/Money.java` already
 * divides by `currency.getDefaultFractionDigits()`, so a JPY tenant's
 * confirmation email says "¥4500" while a hard-coded `/100` on this side would
 * put "¥45" on the page that sold it — the same booking, two prices, and the
 * cheaper one on the screen where the customer agreed to pay. `Intl` knows the
 * same table Java's `Currency` does, so asking it costs one call and removes the
 * whole class of bug. Recorded as a deviation in the wave's decisions.
 *
 * **No `double` touches a price**, for the reason that javadoc gives at more
 * length: `4499 / 100` is not exactly representable, and "€45.00" rendered as
 * "€44.99" is a support ticket about honesty rather than about arithmetic.
 * `Intl.NumberFormat#format` accepts a decimal *string* and parses it exactly,
 * so the scaling below is done with string surgery and the float is never
 * created.
 */

/**
 * How many decimal places this currency actually has. EUR and USD are 2, JPY is
 * 0, BHD is 3.
 */
const digitsByCurrency = new Map<string, number>()

function minorUnitDigits(currency: string): number {
  const cached = digitsByCurrency.get(currency)
  if (cached !== undefined) return cached

  // 'en' rather than the viewer's locale: the *number of decimal places* a
  // currency has is a property of the currency, and pinning the locale here
  // keeps the answer from depending on who is looking.
  //
  // `?? 2` is unreachable in practice — `resolvedOptions()` always fills this in
  // for `style: 'currency'` — and is here because the DOM lib types it optional
  // for the decimal and percent styles that share the interface.
  const digits =
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  digitsByCurrency.set(currency, digits)
  return digits
}

/**
 * `12000` with 2 digits becomes `"120.00"`; `4500` with 0 digits stays `"4500"`.
 *
 * The return type is `${number}` rather than `string` so that the result is
 * assignable to `Intl`'s `StringNumericLiteral`. ECMA-402 has accepted a decimal
 * string here since ES2023 — it is the documented way to format an exact value —
 * but the DOM lib types cannot express "some string that happens to be numeric",
 * so the guarantee is asserted once, here, in the function whose entire job is to
 * produce one.
 */
function toDecimalString(minorUnits: number, digits: number): `${number}` {
  const sign = minorUnits < 0 ? '-' : ''
  const absolute = Math.abs(Math.trunc(minorUnits)).toString()
  if (digits === 0) return `${sign}${absolute}` as `${number}`

  // Pad so that 5 minor units with 2 digits is "0.05" rather than ".5".
  const padded = absolute.padStart(digits + 1, '0')
  return `${sign}${padded.slice(0, -digits)}.${padded.slice(-digits)}` as `${number}`
}

/**
 * A price, formatted for display.
 *
 * @param minorUnits the integer the API sent — `priceCents`, and never a decimal
 * @param currency the **business's** ISO 4217 code. It is a property of the
 *   tenant, not of the service and not of the viewer: `PublicBusinessResponse`
 *   carries one `currency` and each service carries only `priceCents`. Hard-coding
 *   `€` anywhere is a wave gate item.
 * @param locale who is reading. Defaults to the browser's, so a French visitor
 *   gets `120,00 €` and an English one `€120.00` — the same amount in the same
 *   currency, punctuated the way the reader expects. Only the separators move;
 *   the currency never does.
 */
export function formatMoney(minorUnits: number, currency: string, locale?: string): string {
  const digits = minorUnitDigits(currency)
  return formatterFor(currency, digits, locale).format(toDecimalString(minorUnits, digits))
}

/**
 * One formatter per currency and locale, kept.
 *
 * `Intl.NumberFormat` construction is the expensive half of formatting, and a
 * catalogue renders a price per card in a pass. Keyed by locale as well as
 * currency because `locale` is `undefined` in every call this app makes today —
 * it means "the browser's" — and a cache that ignored it would hand the second
 * caller the first one's punctuation the day a screen passes one explicitly.
 */
const formatters = new Map<string, Intl.NumberFormat>()

function formatterFor(currency: string, digits: number, locale?: string): Intl.NumberFormat {
  const key = `${currency}|${locale ?? ''}`
  const cached = formatters.get(key)
  if (cached) return cached

  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  formatters.set(key, formatter)
  return formatter
}
