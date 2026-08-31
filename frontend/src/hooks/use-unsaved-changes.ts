import { useEffect } from 'react'
import { useBlocker } from 'react-router-dom'

/**
 * Two ways out of a form, and both of them have to ask.
 *
 * A screen that holds a lot of state and replaces everything on save — the
 * working-hours grid is the one this exists for — can lose an afternoon's edits
 * to a mis-click on the nav rail. The two exits are genuinely different
 * mechanisms and neither covers the other:
 *
 * - **A route change** stays inside the SPA, so `beforeunload` never fires. It
 *   is caught with React Router's `useBlocker`, which needs a data router — the
 *   app has one (`App.tsx`), and every test mounts `createMemoryRouter`.
 * - **A tab close, a reload, or typing a different address** leaves the document
 *   entirely, where the router cannot see it. Only `beforeunload` catches those,
 *   and the browser shows its own wording — a page cannot choose the sentence,
 *   and Chrome has ignored `returnValue` strings for years. What it *can* choose
 *   is whether the prompt appears at all, which is the whole feature.
 *
 * The blocker returns its state so the caller can render a real dialog rather
 * than a `window.confirm`: the copy has to name what is unsaved, and a native
 * confirm cannot say "seven days of hours".
 */
export type UnsavedChangesGuard = {
  /** True while a navigation is held, waiting for an answer. */
  blocked: boolean
  /** Let it through. The caller has decided the edits are expendable. */
  discard: () => void
  /** Stay here. */
  keepEditing: () => void
}

export function useUnsavedChanges(dirty: boolean): UnsavedChangesGuard {
  const blocker = useBlocker(
    // A function rather than the bare boolean, so the decision is made when the
    // navigation happens rather than at the render that last set it up. It also
    // lets a same-page navigation through: the exceptions panel writes its month
    // to the URL, and a guard that stopped *that* would make the grid impossible
    // to fill in beside it.
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  )

  useEffect(() => {
    if (!dirty) return

    const warn = (event: BeforeUnloadEvent) => {
      // Both lines, and neither is redundant. `preventDefault()` is the standard
      // way to ask for the prompt; assigning `returnValue` is what older WebKit
      // and Firefox builds actually check. The string itself is never shown.
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  return {
    blocked: blocker.state === 'blocked',
    discard: () => blocker.proceed?.(),
    keepEditing: () => blocker.reset?.(),
  }
}
