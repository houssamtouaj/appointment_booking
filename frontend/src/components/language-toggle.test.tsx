import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { LanguageToggle } from '@/components/language-toggle'
import { LANGUAGE_STORAGE_KEY, resetLanguageStoreForTests } from '@/i18n/language'

beforeEach(() => {
  localStorage.clear()
  resetLanguageStoreForTests()
})

describe('the language toggle', () => {
  it('names the language it leads to, not the one showing', () => {
    render(<LanguageToggle />)
    // The trap theme-toggle.tsx's NEXT_LABEL comment describes: a control named
    // for its current state is ambiguous about whether that is where you are or
    // where you are going.
    expect(screen.getByRole('button', { name: 'Passer en français' })).toHaveTextContent('FR')
  })

  it('switches, persists, and then offers the way back', async () => {
    const user = userEvent.setup()
    render(<LanguageToggle />)

    await user.click(screen.getByRole('button', { name: 'Passer en français' }))

    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('fr')
    expect(document.documentElement.lang).toBe('fr')
    expect(screen.getByRole('button', { name: 'Switch to English' })).toHaveTextContent('EN')
  })

  it('keeps two mounted toggles in agreement', async () => {
    const user = userEvent.setup()
    render(
      <>
        <LanguageToggle />
        <LanguageToggle />
      </>,
    )
    const [first] = screen.getAllByRole('button')
    await user.click(first!)
    // Both read the module store, so neither can hold a stale language — the
    // same reason use-theme.ts is a store and not component state.
    expect(screen.getAllByRole('button', { name: 'Switch to English' })).toHaveLength(2)
  })
})
