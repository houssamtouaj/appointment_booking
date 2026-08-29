import { useCallback, useSyncExternalStore } from 'react'

export type Theme = 'system' | 'light' | 'dark'

/**
 * Duplicated in index.html's pre-paint script, on purpose — that script runs
 * before any module is evaluated, so it cannot import this. If you rename the
 * key, rename it there too; `src/hooks/use-theme.test.ts` fails if they drift.
 */
export const THEME_STORAGE_KEY = 'slotflow-theme'

const ORDER: readonly Theme[] = ['system', 'light', 'dark']

/**
 * A module-level store rather than component state, so that two toggles mounted
 * at once (the public header and the admin settings page, from wave 5 on) do not
 * disagree about which theme is active.
 */
let current: Theme = readStored()
const listeners = new Set<() => void>()

function readStored(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    // Private mode, or storage disabled. The OS preference still works, because
    // theme.css falls back to it whenever no data-theme attribute is present.
    return 'system'
  }
}

function apply(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') {
    // Removed, not set to "system": theme.css keys the media-query override off
    // :root:not([data-theme='light']), so the absence of the attribute is what
    // hands control back to the OS.
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', theme)
  }
  // Cleared, not set, for "system" — index.html's pre-paint script writes this
  // inline style to beat the meta tag before the stylesheet lands, and an inline
  // style outranks the color-scheme declarations in theme.css. Leaving a stale
  // one behind would pin the scrollbars and form controls to the theme the user
  // just navigated away from, for the rest of the page's life.
  root.style.colorScheme = theme === 'system' ? '' : theme
}

export function setTheme(theme: Theme) {
  current = theme
  apply(theme)
  try {
    if (theme === 'system') {
      localStorage.removeItem(THEME_STORAGE_KEY)
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    }
  } catch {
    // Non-fatal: the theme still applies for this page's lifetime.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): Theme {
  return current
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, () => 'system' as Theme)

  /** system → light → dark → system. Three states, because "follow the OS" is one. */
  const cycleTheme = useCallback(() => {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]
    // noUncheckedIndexedAccess: the modulo makes this unreachable, but the
    // compiler cannot know that and a silent `undefined` here would clear the
    // attribute rather than advance it.
    if (next) setTheme(next)
  }, [theme])

  return { theme, setTheme, cycleTheme }
}

/** Exported for tests, which need to reset the store between cases. */
export function resetThemeStoreForTests() {
  current = readStored()
  apply(current)
}
