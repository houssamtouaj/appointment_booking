import { useSyncExternalStore } from 'react'

/**
 * A media query, as React state.
 *
 * `useSyncExternalStore` rather than `useEffect` + `useState`, and it is not a
 * stylistic preference: the effect version renders once with a guessed value and
 * then corrects itself, which on this app's use — choosing between a week grid
 * and a day grid — is a visible flash of the wrong calendar on every load. This
 * one reads the real value during the first render.
 *
 * **The server snapshot is `false`.** There is no server here, but the same
 * argument decides the jsdom case: a zero-size window matches nothing, so tests
 * get the desktop branch unless they say otherwise, which is the branch with
 * more on screen to assert about.
 */

/**
 * Below this the week grid becomes the day grid.
 *
 * Tailwind's `md`. Seven day columns need about 900px to stay legible, so the
 * question is only where between 375 and 900 to switch, and matching the token
 * the rest of the app lays out on means the calendar changes shape at the same
 * width as everything around it rather than at a number of its own.
 */
export const WEEK_GRID_MIN_WIDTH = '(min-width: 768px)'

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      // jsdom has no layout engine and, in older setups, no `matchMedia` at all.
      // The app's test setup provides one; a browser that somehow lacks it gets
      // the same answer as a window that matches nothing rather than a crash.
      const list = window.matchMedia?.(query)
      if (!list) return () => {}

      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  )
}
