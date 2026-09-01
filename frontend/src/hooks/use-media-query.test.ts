import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useMediaQuery, WEEK_GRID_MIN_WIDTH } from '@/hooks/use-media-query'

/**
 * The hook is exercised indirectly by `calendar.test.tsx`, which asserts the
 * calendar's breakpoint behaviour. This file asserts the hook's own three
 * branches instead — the subscription, the teardown, and the environment with no
 * `matchMedia` — because the middle one is invisible from a screen test: a
 * listener that is never removed shows up as a warning in a later, unrelated
 * case rather than as a failure here.
 */

const realMatchMedia = window.matchMedia

afterEach(() => {
  window.matchMedia = realMatchMedia
})

/** A controllable media query list: nothing here is jsdom's, so `change` can be fired. */
function stubMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>()
  let matches = initial
  const addEventListener = vi.fn((_: string, listener: () => void) => {
    listeners.add(listener)
  })
  const removeEventListener = vi.fn((_: string, listener: () => void) => {
    listeners.delete(listener)
  })

  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    get matches() {
      return matches
    },
    media: query,
    onchange: null,
    addEventListener,
    removeEventListener,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))

  return {
    addEventListener,
    removeEventListener,
    /** What the browser does when the viewport crosses the breakpoint. */
    change(next: boolean) {
      matches = next
      act(() => {
        for (const listener of listeners) listener()
      })
    },
  }
}

describe('useMediaQuery', () => {
  it('reads the real value on the first render, with no correcting second pass', () => {
    stubMatchMedia(true)

    const { result } = renderHook(() => useMediaQuery(WEEK_GRID_MIN_WIDTH))

    expect(result.current).toBe(true)
  })

  it('re-renders when the query starts matching', () => {
    const media = stubMatchMedia(false)
    const { result } = renderHook(() => useMediaQuery(WEEK_GRID_MIN_WIDTH))
    expect(result.current).toBe(false)

    media.change(true)

    expect(result.current).toBe(true)
  })

  it('removes the change listener on unmount', () => {
    const media = stubMatchMedia(false)
    const { unmount } = renderHook(() => useMediaQuery(WEEK_GRID_MIN_WIDTH))

    expect(media.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    const [, subscribed] = media.addEventListener.mock.calls[0] ?? []

    unmount()

    // The same function, not merely a call to `removeEventListener`: passing a
    // different one is how a listener survives its component.
    expect(media.removeEventListener).toHaveBeenCalledWith('change', subscribed)
  })

  it('answers false, and does not throw, where matchMedia does not exist', () => {
    // Older jsdom, and any environment that never implemented it. The optional
    // call in the hook is the whole point of this case.
    Reflect.deleteProperty(window, 'matchMedia')

    const { result, unmount } = renderHook(() => useMediaQuery(WEEK_GRID_MIN_WIDTH))

    expect(result.current).toBe(false)
    // The no-op unsubscribe has to be callable too.
    expect(() => unmount()).not.toThrow()
  })
})
