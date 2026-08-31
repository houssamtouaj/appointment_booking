import '@testing-library/jest-dom/vitest'

import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

/**
 * Five seconds for `findBy*` and `waitFor`, not Testing Library's one.
 *
 * This is a separate budget from Vitest's `testTimeout` (vite.config.ts) and
 * neither covers the other: `testTimeout` is how long a case may run, and this
 * is how long one query may wait before giving up and reporting "unable to find"
 * — which is a *failure*, with a DOM dump, not a timeout. Under contention that
 * is the more misleading of the two, because it accuses the component of never
 * rendering when it simply had not rendered yet.
 *
 * One second is generous for a query in a file with a core to itself, and tight
 * when eight workers are each driving a jsdom document through a mounted router,
 * a bootstrap round trip and a mutation. Waiting longer costs nothing on a green
 * run: these helpers poll and return the moment the element appears.
 */
configure({ asyncUtilTimeout: 5_000 })

// Testing Library auto-cleans only when it can detect the test framework's globals
// at import time. Vitest's `globals: true` makes that work today, but wiring it
// explicitly means a later switch to `globals: false` does not silently start
// leaking mounted trees between tests.
afterEach(cleanup)

// jsdom does not implement matchMedia and has no plans to -- it has no layout
// engine, so there is nothing for a media query to be true about. Anything that
// asks the browser about the viewport or the colour scheme throws without this:
// sonner does it on mount, and from wave 6 the calendar's week/day breakpoint
// will too.
//
// It reports "no match" for everything, which is the honest answer for a
// zero-size window. A test that needs a query to match should override this
// rather than rely on a global default.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(), // deprecated, but sonner and Radix still feature-detect it
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}
