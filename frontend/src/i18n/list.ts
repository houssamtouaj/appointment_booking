import { currentLocale } from '@/i18n'

/**
 * `"Tuesday, Thursday and Friday"`, `"mardi, jeudi et vendredi"`.
 *
 * `Intl.ListFormat` rather than joining with `', '` and `' and '`, for the same
 * reason `Intl.PluralRules` replaced the `=== 1` ternaries: the conjunction is
 * the language's, not this file's, and French does not put a comma before it
 * either.
 *
 * It lives here rather than in `hours-dialogs.tsx`, where wave 10 first wrote it,
 * because three other places were enumerating people with `.join(', ')` — the
 * unbookable chip's reason, the team row's list of services, and the service
 * row's `sr-only` sentence. A bare comma-separated enumeration is not *wrong* in
 * either language, but the rule this wave wrote down says the separator is
 * `Intl`'s job, and a rule with three exceptions in the same PR is not a rule.
 *
 * One formatter per locale, cached like every other `Intl` object in this
 * codebase: constructing one per render is the cost that makes people reach for
 * `.join` in the first place.
 */
const formatters = new Map<string, Intl.ListFormat>()

export function formatList(items: readonly string[]): string {
  const locale = currentLocale()
  let formatter = formatters.get(locale)
  if (!formatter) {
    formatter = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' })
    formatters.set(locale, formatter)
  }
  return formatter.format(items)
}
