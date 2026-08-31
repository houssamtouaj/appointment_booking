import { z } from 'zod'

/**
 * Scalars that appear in more than one resource, declared once so that a change
 * to what the API sends is a change to one line rather than a search.
 *
 * The rule this file exists to enforce, and the reason wave 2 hand-writes Zod
 * schemas instead of generating them from `/v3/api-docs` (F3): **the generator
 * would be wrong here.** springdoc types `Currency` as `object`, because that is
 * what Jackson's currency serialiser looks like through reflection, while the
 * bytes on the wire are the three-letter string `"EUR"`. A generated client
 * would hand every price formatter an `object`, and the mismatch would surface
 * as `Intl.NumberFormat` throwing at runtime rather than as a type error.
 *
 * `npm run contract:check` is the other half of that trade: hand-written schemas
 * can drift from the API, so a script diffs them against the live document.
 */

/**
 * A `java.util.UUID`, from any of the API's `id` fields.
 *
 * `z.guid()` rather than `z.uuid()`, and the difference matters: `z.uuid()`
 * also checks the version and variant nibbles, so it accepts v1–v8 and rejects
 * anything else. Today the API only ever sends `UUID.randomUUID()`, which is v4
 * and passes either check — but the day a column is backfilled with a v7, or a
 * fixture uses a hand-written id, the strict form turns a perfectly usable
 * identifier into a blank screen. The asymmetry decides it: a rejected valid id
 * blacks out a page, and an accepted odd-looking one is a string we hand
 * straight back to the API.
 */
export const uuid = z.guid()

/**
 * An IANA zone id — `"Europe/Paris"`. Deliberately not validated against the tz
 * database here: the browser's list and the server's can legitimately differ by
 * a release, and rejecting a zone the API considers valid would black out a
 * whole tenant over a rename.
 *
 * The other half of that trade lives in `lib/time.ts`, which probes the zone
 * once and falls back to UTC for one this browser cannot resolve. It has to be
 * there and not here: `Intl` throws `RangeError` from inside a render, this app
 * has no error boundary above the public screens, and an unhandled throw at that
 * depth is a white page rather than a fallback.
 */
export const zoneId = z.string().min(1)

/**
 * ISO 4217, upper case. The OpenAPI document types this `object`; see the file
 * header. Three letters is the whole contract, and `RegisterRequest` enforces
 * exactly that regex on the way in.
 */
export const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'must be a three-letter ISO 4217 code')

/** An ISO-8601 instant, as Jackson writes `Instant`. */
export const isoInstant = z.iso.datetime({ offset: true })

/**
 * A `java.time.LocalTime`, `"08:30:00"` — or `"08:30"`, which is what Jackson
 * actually writes when the seconds are zero.
 *
 * Kept as the string the API sent rather than parsed into a `Date`. It is a wall
 * clock with no date and no zone attached — the salon opens at 08:30 every
 * Monday, not at an instant — and giving it a date is how it acquires an offset
 * it never had and shifts by an hour twice a year.
 *
 * Declared here rather than beside the first resource that used it, because from
 * wave 8 it is on three: the public page's opening hours, a weekly working-hours
 * range, and the times on a one-off override.
 */
export const localTime = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'expected HH:mm:ss')

/**
 * A `java.time.LocalDate`, `"2026-12-25"`. A calendar date in the business
 * timezone, and — like {@link localTime} — never an instant: "closed on Christmas
 * Day" is a fact about a date, and framing it in a zone is how it becomes the
 * 24th for somebody.
 */
export const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected yyyy-MM-dd')
