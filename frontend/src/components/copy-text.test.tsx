import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CopyText } from '@/components/copy-text'

/**
 * The four things this component promises, and each of them is a decision the
 * doc comment argues for: the value is on screen whatever the clipboard does,
 * the confirmation announces without stealing focus, it goes away on its own,
 * and a blocked clipboard is quiet rather than an error.
 */

const LINK = 'https://slotflow.app/booking/9f1c-not-a-real-token'

/**
 * jsdom has no clipboard. `userEvent.setup()` installs its own stub, so this
 * replaces the property outright rather than spying on a method that may not
 * exist yet.
 */
function stubClipboard(writeText: () => Promise<void>) {
  const spy = vi.fn(writeText)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: spy },
    configurable: true,
    writable: true,
  })
  return spy
}

/** No clipboard at all: an insecure origin, or an embedded browser. */
function removeClipboard() {
  Object.defineProperty(navigator, 'clipboard', {
    value: undefined,
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the copyable value', () => {
  it('shows the value in full, whatever the clipboard does', () => {
    render(<CopyText value={LINK} label="Your booking link" />)

    // Not truncated in the DOM: this is the only credential a customer has for
    // their booking, and somebody may be copying it onto paper.
    expect(screen.getByText(LINK)).toBeInTheDocument()
  })

  it('copies the exact value and announces it without moving focus', async () => {
    const user = userEvent.setup()
    const writeText = stubClipboard(() => Promise.resolve())
    render(<CopyText value={LINK} label="Your booking link" />)

    const button = screen.getByRole('button', { name: /copy.*your booking link/i })
    await user.click(button)

    expect(writeText).toHaveBeenCalledExactlyOnceWith(LINK)
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Your booking link copied')
    // `role="status"` and not a dialog or a toast: the press must not cost the
    // person their place.
    expect(button).toHaveFocus()
    expect(button).toHaveAccessibleName(/copied/i)
  })

  it('goes back to Copy after two seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    stubClipboard(() => Promise.resolve())
    render(<CopyText value={LINK} label="Your booking link" />)

    await user.click(screen.getByRole('button', { name: /copy/i }))
    expect(await screen.findByRole('status')).toHaveTextContent('copied')

    await vi.advanceTimersByTimeAsync(2000)

    await waitFor(() => expect(screen.getByRole('status')).toBeEmptyDOMElement())
    expect(screen.getByRole('button', { name: /copy/i })).toHaveAccessibleName(/^Copy/)
  })

  it('says nothing when the clipboard is unavailable', async () => {
    const user = userEvent.setup()
    removeClipboard()
    render(<CopyText value={LINK} label="Your booking link" />)

    await user.click(screen.getByRole('button', { name: /copy/i }))

    // Quiet on purpose: the value is on screen, so a failure here costs nothing
    // and an error about it would be a message the person cannot act on. But it
    // must not claim success either.
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(screen.getByRole('button', { name: /copy/i })).toHaveAccessibleName(/^Copy/)
    expect(screen.getByText(LINK)).toBeInTheDocument()
  })

  it('says nothing when the clipboard write is refused', async () => {
    const user = userEvent.setup()
    stubClipboard(() => Promise.reject(new Error('Document is not focused')))
    render(<CopyText value={LINK} label="Your booking link" />)

    await user.click(screen.getByRole('button', { name: /copy/i }))

    await waitFor(() => expect(screen.getByRole('status')).toBeEmptyDOMElement())
  })

  it('clears its timer on unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const clear = vi.spyOn(window, 'clearTimeout')
    stubClipboard(() => Promise.resolve())
    const { unmount } = render(<CopyText value={LINK} label="Your booking link" />)

    await user.click(screen.getByRole('button', { name: /copy/i }))
    await screen.findByRole('status')
    const pending = vi.getTimerCount()
    expect(pending).toBeGreaterThan(0)

    unmount()

    // People leave this screen the moment they have what they came for, and the
    // reset would otherwise fire into an unmounted tree.
    expect(clear).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
  })
})
