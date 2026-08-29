import { render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { DEMO_SLUG } from '@/lib/env'
import { routes } from '@/routes'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  return render(<RouterProvider router={router} />)
}

describe('the application shell', () => {
  it('renders the shell and its skip link', () => {
    renderAt('/dashboard')

    expect(screen.getByRole('link', { name: 'Skip to content' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
  })

  it('redirects the bare root to the demo tenant (F16)', () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/'] })
    render(<RouterProvider router={router} />)

    expect(router.state.location.pathname).toBe(`/b/${DEMO_SLUG}`)
  })

  it('renders a real 404 rather than redirecting', () => {
    renderAt('/no-such-page')

    expect(screen.getByRole('heading', { level: 1, name: 'No such page' })).toBeInTheDocument()
  })
})

describe('the route table', () => {
  // F12: three of these are built into outbound mail by the backend's
  // FrontendLinks. A link in an inbox from three weeks ago still has to resolve,
  // so this test exists to make a rename fail loudly rather than quietly.
  const paths = [
    '/b/demo-salon',
    '/b/demo-salon/book',
    '/booking/some-cancellation-token',
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password/some-token',
    '/accept-invitation/some-token',
    '/dashboard',
    '/calendar',
    '/services',
    '/team',
    '/team/11111111-1111-1111-1111-111111111111/hours',
    '/settings',
  ]

  it.each(paths)('%s resolves to a page, not the 404', (path) => {
    renderAt(path)

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toBeInTheDocument()
    expect(heading).not.toHaveTextContent('No such page')
  })
})
