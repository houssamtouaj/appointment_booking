import { currentLocale } from '@/i18n'

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
 * @param locale who is reading. Defaults to **the language chosen in this app**
 *   (F23), not to the browser's — a visitor who switches to French gets
 *   `120,00 €` and an English one `€120.00`, the same amount in the same
 *   currency, punctuated the way the reader asked for. Only the separators move;
 *   the currency never does.
 */
export function formatMoney(minorUnits: number, currency: string, locale?: string): string {
  const digits = minorUnitDigits(currency)
  // Resolved here rather than inside `formatterFor`, so the cache is keyed by the
  // locale actually used and a language switch cannot be served a stale entry.
  return formatterFor(currency, digits, locale ?? currentLocale()).format(
    toDecimalString(minorUnits, digits),
  )
}

/**
 * One formatter per currency and locale, kept.
 *
 * `Intl.NumberFormat` construction is the expensive half of formatting, and a
 * catalogue renders a price per card in a pass. Keyed by locale as well as
 * currency because a language switch changes it and both formatters then stay
 * warm — before wave 10 this parameter was `undefined` at every call site and the
 * note here said so. A cache that ignored the locale would hand a French reader
 * the English reader's punctuation.
 */
const formatters = new Map<string, Intl.NumberFormat>()

function formatterFor(currency: string, digits: number, locale: string): Intl.NumberFormat {
  const key = `${currency}|${locale}`
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

// ---------------------------------------------------------------------------
//  The other direction: what a person typed, as the integer the API wants
// ---------------------------------------------------------------------------

/**
 * How many decimal places a price may be entered with. Exported because the
 * catalogue form needs it for the input's `step` and for its placeholder, and
 * because a second copy of the `?? 2` fallback is a second thing to get wrong.
 */
export function currencyDigits(currency: string): number {
  return minorUnitDigits(currency)
}

/**
 * `12000` as `"120.00"` — the string that goes *into* the price input when an
 * existing service is opened for editing.
 *
 * Not `formatMoney`: an input's value has to be a bare decimal with a `.`
 * separator whatever the reader's locale is, because that is the only thing
 * `<input type="number">` accepts and the only thing {@link toMinorUnits} reads
 * back. The currency symbol belongs beside the field, not inside it.
 */
export function toAmountInput(minorUnits: number, currency: string): string {
  return toDecimalString(minorUnits, minorUnitDigits(currency))
}

/**
 * What the price field will accept at all. Digits, one separator, digits.
 *
 * A regex rather than `Number.isFinite(Number(text))`, because the strings that
 * pass the latter and must not pass here are exactly the ones that would reach
 * the arithmetic below as something it cannot read exactly: `1e3`, `0x10`,
 * `Infinity`, and the empty string — `Number('')` is `0`, so a blank price field
 * validated that way is a free service rather than a missing answer.
 *
 * A comma is accepted as well as a dot. `<input type="number">` never produces
 * one — the spec makes its `value` a valid floating-point number or the empty
 * string, always with a `.` — but a person pasting `12,10` out of a spreadsheet
 * is a real event, and refusing it would be a validation message about
 * punctuation.
 */
const AMOUNT_PATTERN = /^\d*(?:[.,]\d*)?$/

/** True when {@link toMinorUnits} can read this text. `''` and `'.'` cannot. */
export function isAmountInput(text: string): boolean {
  const trimmed = text.trim()
  if (!AMOUNT_PATTERN.test(trimmed)) return false
  // At least one digit somewhere. '.' and ',' pass the pattern and are not
  // numbers, and `''` is the untouched field rather than zero.
  return /\d/.test(trimmed)
}

/**
 * `"12.10"` in EUR is `1210`. **No `double` is created on the way**, which is
 * the whole reason this is eleven lines rather than `Math.round(n * 100)`.
 *
 * The wave plan motivates this with `12.10 * 100`, and that example is half
 * right in a way worth recording: the double nearest 12.10 is
 * 12.099999999999999645, but multiplying it by 100 rounds back to exactly 1210,
 * so `Math.round` is not even needed there. The bug is real all the same and
 * `Math.round` does **not** rescue it — 572 of the 10 000 two-decimal half-cent
 * prices land the wrong side, `0.145 → 14` and `1.005 → 100` among them, each
 * one a cent cheaper than the price that was typed and arrived at by a route
 * nobody reading `n * 100` would suspect. Moving the decimal point in a *string*
 * has no such cases, because there is no representation error to accumulate.
 * `money.test.ts` proves both halves rather than trusting this paragraph.
 *
 * Rounding is **half away from zero** on the exact digits, applied only when
 * somebody has typed more precision than the currency has. That matches what a
 * person reading their own input expects (`.005` rounds up) and it matches
 * `BigDecimal.setScale(digits, HALF_UP)`, which is what the backend would do if
 * it ever took a decimal — it does not; it takes these minor units.
 *
 * The digit count is the **currency's**, not two: a JPY price of `4500` is 4500
 * minor units and not 450000, for the same reason `formatMoney` divides by the
 * currency's own scale.
 *
 * @throws Error when the text is not something {@link isAmountInput} accepts.
 *   The form validates first, so this is the programmer-error path rather than
 *   the user-error one, and it throws rather than returning `NaN` — a `NaN`
 *   would serialise to `null` in JSON and come back as a 422 about a field the
 *   person filled in correctly.
 */
export function toMinorUnits(amount: string, currency: string): number {
  if (!isAmountInput(amount)) {
    throw new Error(`not an amount: ${JSON.stringify(amount)}`)
  }

  const digits = minorUnitDigits(currency)
  const [whole, fraction = ''] = amount.trim().replace(',', '.').split('.')

  // Pad to the currency's scale, then take one digit more than needed: that
  // extra digit is the entire rounding decision.
  const scaled = fraction.padEnd(digits + 1, '0')
  const kept = `${whole || '0'}${scaled.slice(0, digits)}`
  const units = Number(kept)

  // Everything after the kept digits, not just the first of them: `12.0049` must
  // round down and `12.005` must round up, and looking only at the `0` and the
  // `4` respectively cannot tell those apart. Compared as a string against the
  // half-way point of the same length, so no float is created here either.
  const remainder = scaled.slice(digits)
  const roundsUp = remainder >= '5'.padEnd(remainder.length, '0')

  return roundsUp ? units + 1 : units
}
