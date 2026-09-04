/**
 * Which language the interface is written in, as a module-scope store.
 *
 * Deliberately a near-copy of `src/hooks/use-theme.ts`, down to the shape of the
 * try/catch, because it is solving the same problem: a per-device preference
 * that has to be readable before React mounts, readable from code that is not a
 * component, and identical for every control that shows it.
 *
 * **This file imports nothing.** `src/lib/time.ts` and `src/lib/money.ts` read
 * it (F23) and they are the bottom layer of the app; an import in this direction
 * is what keeps that acyclic.
 */

export type Language = 'en' | 'fr'

const LANGUAGES: readonly Language[] = ['en', 'fr']

/**
 * Duplicated in index.html's pre-paint script, on purpose — that script runs
 * before any module is evaluated, so it cannot import this. If you rename the
 * key, rename it there too; `src/i18n/language.test.ts` fails if they drift.
 */
export const LANGUAGE_STORAGE_KEY = 'slotflow-lang'

export function isLanguage(value: string): value is Language {
  return LANGUAGES.some((language) => language === value)
}

/**
 * The language to start in when nothing has been chosen (F22).
 *
 * `navigator.languages` rather than `navigator.language`: a French speaker with
 * an English-first OS often lists `fr` second, and honouring the list is the
 * whole reason the browser publishes one. Any `fr-*` counts — `fr-CA` and `fr-BE`
 * read this interface perfectly well.
 */
function detect(): Language {
  const preferences = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [])
  for (const tag of preferences) {
    const base = tag.toLowerCase().split('-')[0]
    if (base && isLanguage(base)) return base
  }
  return 'en'
}

function readStored(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    // A corrupted value degrades to the browser's preference rather than
    // throwing, for the same reason the theme key is a plain string and not JSON.
    return stored !== null && isLanguage(stored) ? stored : detect()
  } catch {
    // Private mode, or storage disabled. The browser preference still works.
    return detect()
  }
}

let current: Language = readStored()
const listeners = new Set<() => void>()

/**
 * Stamped once at module init, and not only from `setLanguage`.
 *
 * The failure this closes: `setLanguage` early-returns when the value has not
 * changed, so a browser listing `['nl-BE', 'fr-BE']` with nothing stored used to
 * render the whole app in French while `<html lang>` kept whatever the document
 * arrived with. index.html's script derives the same value and would normally
 * have stamped it already — this is what makes the two impossible to leave
 * disagreeing, rather than a duplicate of it.
 */
apply(current)

/**
 * Stamped on `<html>` as well as held here, because the document language is not
 * decoration: a screen reader picks its voice from it, and the browser picks
 * hyphenation and spell-check from it. index.html's script sets it before first
 * paint; this keeps it true after a switch.
 *
 * Guarded, because this module is imported by `lib/time.ts` and `lib/money.ts`
 * and is the bottom of the app — it must not be the reason a non-DOM
 * environment throws on import.
 */
function apply(language: Language) {
  if (typeof document !== 'undefined') document.documentElement.lang = language
}

export function currentLanguage(): Language {
  return current
}

export function setLanguage(next: Language) {
  if (next === current) return
  current = next
  apply(next)
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, next)
  } catch {
    // Non-fatal: the choice still holds for this page's lifetime.
  }
  for (const listener of listeners) listener()
}

export function subscribeToLanguage(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Exported for tests, which need to reset the store between cases. */
export function resetLanguageStoreForTests() {
  current = readStored()
  apply(current)
}
