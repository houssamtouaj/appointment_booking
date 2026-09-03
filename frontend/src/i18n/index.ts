import { useCallback, useSyncExternalStore } from 'react'

import { en } from '@/i18n/en'
import { fr } from '@/i18n/fr'
import { currentLanguage, subscribeToLanguage, type Language } from '@/i18n/language'

/**
 * A plural leaf. `one` and `other` are required because every language this app
 * has needs both; the rest are optional because `Intl.PluralRules` may ask for
 * them and French, for instance, has `many`.
 */
type PluralForms = {
  one: string
  other: string
  zero?: string
  two?: string
  few?: string
  many?: string
}

type Node = string | PluralForms | { readonly [key: string]: Node }

/**
 * The shape `fr` must match: the same keys, the same nesting, any string values.
 *
 * `typeof en` alone cannot be used — `as const` types every English value as a
 * string *literal*, so every French string would fail to match. Relaxing the
 * leaves and keeping the structure is what makes this a shape check rather than
 * a value check.
 */
export type Same<T> = {
  [K in keyof T]: T[K] extends string ? string : T[K] extends PluralForms ? PluralForms : Same<T[K]>
}

/** Every leaf path, dotted: `common.cancel`, `booking.slotCount`. */
type Paths<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends PluralForms
      ? K
      : `${K}.${Paths<T[K]>}`
}[keyof T & string]

export type TKey = Paths<typeof en>

export type Vars = Record<string, string | number>

const DICTIONARIES: Record<Language, Node> = { en, fr }

/**
 * The region each language formats dates and money in.
 *
 * **The browser's own region wins when it agrees with the language**, and this is
 * not a nicety: `en` alone resolves as en-US, which writes "Monday, September 3"
 * where en-GB writes "Monday 3 September". Playwright pins `locale: 'en-GB'` and
 * locates slot chips by their formatted accessible name, so collapsing the region
 * would rewrite the e2e spec. Honouring the browser also means an American visitor
 * keeps American dates, and the same visitor switching to French gets fr-FR
 * rather than a nonsense `fr-US`.
 */
const FALLBACK_LOCALE: Record<Language, string> = { en: 'en-GB', fr: 'fr-FR' }

export function localeFor(language: Language): string {
  const preferences = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [])
  const match = preferences.find((tag) => tag.toLowerCase().startsWith(language))
  return match ?? FALLBACK_LOCALE[language]
}

/** The locale for the language currently chosen. The form `lib/` reads (F23). */
export function currentLocale(): string {
  return localeFor(currentLanguage())
}

function lookup(dictionary: Node, key: string): Node | undefined {
  let node: Node | undefined = dictionary
  for (const segment of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as { [k: string]: Node })[segment]
  }
  return node
}

function isPlural(node: Node): node is PluralForms {
  return typeof node === 'object' && node !== null && 'other' in node
}

/**
 * Substitution, and a missing variable stays visible.
 *
 * Rendering `{time}` on screen is ugly and gets reported the first time anybody
 * sees it. Rendering an empty string reads as finished copy and ships.
 */
function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  )
}

const pluralRules = new Map<Language, Intl.PluralRules>()

function selectPlural(language: Language, forms: PluralForms, count: number): string {
  let rules = pluralRules.get(language)
  if (!rules) {
    rules = new Intl.PluralRules(localeFor(language))
    pluralRules.set(language, rules)
  }
  // French counts 0 as singular and English as plural, which is the whole reason
  // this is not `count === 1`. `other` is the fallback every language defines.
  return forms[rules.select(count)] ?? forms.other
}

export function translateIn(language: Language, key: TKey, vars?: Vars): string {
  const node = lookup(DICTIONARIES[language], key)

  if (node === undefined) {
    // Unreachable through `TKey`, and reachable through a cast or a dictionary
    // edited without a rebuild. The key is the least-worst thing to show: it says
    // what is missing, where an empty span says nothing at all.
    return key
  }

  if (isPlural(node)) {
    const count = typeof vars?.count === 'number' ? vars.count : 0
    return interpolate(selectPlural(language, node, count), vars)
  }

  return typeof node === 'string' ? interpolate(node, vars) : key
}

/**
 * Translate outside a component.
 *
 * This is what lets `describeError` — a plain function called from mutation
 * handlers and error boundaries — produce French without becoming a hook. It
 * reads the module store directly, exactly as `formatMoney` reads it.
 */
export function translate(key: TKey, vars?: Vars): string {
  return translateIn(currentLanguage(), key, vars)
}

export function useLanguage(): Language {
  return useSyncExternalStore(subscribeToLanguage, currentLanguage, () => 'en' as Language)
}

/**
 * Translate inside a component, and re-render when the language changes.
 *
 * **`t` gets a new identity per language, and that is deliberate.** A stable `t`
 * would be the more obvious hook and would leave every `React.memo` child showing
 * the previous language until something else re-rendered it — the failure is
 * invisible in a small tree and permanent in a big one.
 */
export function useTranslation() {
  const lang = useLanguage()
  const t = useCallback((key: TKey, vars?: Vars) => translateIn(lang, key, vars), [lang])
  return { t, lang, locale: localeFor(lang) }
}
