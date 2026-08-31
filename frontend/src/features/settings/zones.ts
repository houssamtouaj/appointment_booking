/**
 * The IANA zones this browser knows about, for the timezone field's
 * suggestions.
 *
 * Suggestions and not a closed list, which is the whole reason this returns an
 * array rather than being a `<select>`: `Intl.supportedValuesOf` reports *this
 * browser's* copy of the tz database, and the server has its own. They can
 * legitimately differ by a release — a zone is renamed, a new one is added —
 * and a form that refused anything absent here would make a tenant unable to
 * save a zone the API considers perfectly valid. The server validates; this
 * helps somebody type.
 *
 * `supportedValuesOf` is ES2022 and absent from older engines, so a failure
 * degrades to no suggestions rather than to a broken form: a bare text input
 * that the server still validates is a worse experience and a working one.
 * Computed once, because the list is around six hundred entries and does not
 * change while a page is open.
 */
let cached: readonly string[] | undefined

export function browserZones(): readonly string[] {
  if (cached) return cached

  try {
    cached = Intl.supportedValuesOf('timeZone')
  } catch {
    cached = []
  }
  return cached
}
