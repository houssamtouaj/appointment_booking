import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useUnsavedChanges } from '@/hooks/use-unsaved-changes'

/**
 * The hook has two independent mechanisms and the screen tests reach one and a
 * half of them: `hours.test.tsx` drives the router blocker and asserts that a
 * `beforeunload` handler is *registered* while there are edits. What it cannot
 * see from up there is the other half of that pair — the handler being taken off
 * again when the form goes clean, and put back when it goes dirty a second time
 * — nor what the handler does when it fires.
 *
 * A route element rather than `renderHook`: `useBlocker` needs a data router, and
 * a hook rendered in a wrapper is not inside one.
 */

function Harness({ initialDirty = false }: { initialDirty?: boolean }) {
  const [dirty, setDirty] = useState(initialDirty)
  const guard = useUnsavedChanges(dirty)

  return (
    <div>
      <button onClick={() => setDirty(true)}>Edit</button>
      <button onClick={() => setDirty(false)}>Clean</button>
      <Link to="/away">Leave</Link>

      {guard.blocked ? (
        <div role="dialog" aria-label="Unsaved changes">
          <button onClick={guard.discard}>Discard</button>
          <button onClick={guard.keepEditing}>Stay</button>
        </div>
      ) : null}
    </div>
  )
}

function renderGuard(initialDirty = false) {
  const router = createMemoryRouter(
    [
      { path: '/edit', element: <Harness initialDirty={initialDirty} /> },
      { path: '/away', element: <p>Somewhere else</p> },
    ],
    { initialEntries: ['/edit'] },
  )
  render(<RouterProvider router={router} />)
  return router
}

/** Every `beforeunload` add and remove, in order, so a pair can be matched up. */
function traceBeforeUnload() {
  const added: EventListener[] = []
  const removed: EventListener[] = []
  // Bound before the spy replaces them, so the real registration still happens —
  // the handler has to actually be attached for the dispatch case below.
  const realAdd = window.addEventListener.bind(window)
  const realRemove = window.removeEventListener.bind(window)

  vi.spyOn(window, 'addEventListener').mockImplementation((event, listener, options) => {
    if (event === 'beforeunload' && typeof listener === 'function') added.push(listener)
    return realAdd(event, listener, options)
  })
  vi.spyOn(window, 'removeEventListener').mockImplementation((event, listener, options) => {
    if (event === 'beforeunload' && typeof listener === 'function') removed.push(listener)
    return realRemove(event, listener, options)
  })
  return { added, removed }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the route-change exit', () => {
  it('holds a navigation to another path while there are edits', async () => {
    const user = userEvent.setup()
    const router = renderGuard()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('link', { name: 'Leave' }))

    expect(await screen.findByRole('dialog', { name: 'Unsaved changes' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/edit')
  })

  it('lets it through on discard, and stays put on keepEditing', async () => {
    const user = userEvent.setup()
    const router = renderGuard(true)

    await user.click(screen.getByRole('link', { name: 'Leave' }))
    await user.click(await screen.findByRole('button', { name: 'Stay' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(router.state.location.pathname).toBe('/edit')

    await user.click(screen.getByRole('link', { name: 'Leave' }))
    await user.click(await screen.findByRole('button', { name: 'Discard' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/away'))
  })

  it('does not hold anything while the form is clean', async () => {
    const user = userEvent.setup()
    const router = renderGuard()

    await user.click(screen.getByRole('link', { name: 'Leave' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/away'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('the leaving-the-document exit', () => {
  it('takes the handler off again when the form goes clean, and puts it back on a second edit', async () => {
    const user = userEvent.setup()
    const trace = traceBeforeUnload()
    renderGuard()

    expect(trace.added).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(trace.added).toHaveLength(1))
    expect(trace.removed).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Clean' }))

    // The same function that was added, which is the only kind of removal that
    // actually detaches it.
    await waitFor(() => expect(trace.removed).toEqual([trace.added[0]]))

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(trace.added).toHaveLength(2))
  })

  it('removes the handler on unmount', async () => {
    const trace = traceBeforeUnload()
    const router = createMemoryRouter([{ path: '/edit', element: <Harness initialDirty /> }], {
      initialEntries: ['/edit'],
    })
    const { unmount } = render(<RouterProvider router={router} />)

    await waitFor(() => expect(trace.added).toHaveLength(1))
    unmount()

    expect(trace.removed).toEqual([trace.added[0]])
  })

  it('asks for the browser prompt when it fires', async () => {
    const user = userEvent.setup()
    const trace = traceBeforeUnload()
    renderGuard()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(trace.added).toHaveLength(1))

    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)

    // One assertion for the handler's two lines, and that is jsdom's limit
    // rather than a gap: it has no `BeforeUnloadEvent`, and plain `Event`
    // implements `returnValue` as the legacy boolean alias for cancellation. So
    // `preventDefault()` and `returnValue = ''` are indistinguishable here —
    // both arrive as a cancelled event. The reason both lines exist is which
    // engines read which, which no jsdom test can see.
    expect(event.defaultPrevented).toBe(true)
  })

  it('does not ask when the form is clean', () => {
    renderGuard()

    // Nothing to click: a clean form registers no handler at all, so an unload
    // proceeds without a prompt.
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })
})
