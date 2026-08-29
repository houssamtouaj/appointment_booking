import { Navigate, type RouteObject } from 'react-router-dom'

import { RootLayout } from '@/components/root-layout'
import { DEMO_SLUG } from '@/lib/env'
import { NotFoundPage } from '@/pages/not-found'
import { Placeholder } from '@/pages/placeholder'

/**
 * The whole route table, stubbed. Written in full in wave 1 on purpose: with it
 * here, wave 3 adds a screen, and without it wave 3 makes a routing decision
 * while also building a slot picker.
 *
 * Two rules constrain the shape and neither is ours to change:
 *
 *   F16 — public booking pages live under `/b/:slug`, and `/` redirects to the
 *   demo tenant. The prefix keeps a business whose slug is `login` from
 *   shadowing the admin route, and the redirect is what makes the portfolio link
 *   land on something alive.
 *
 *   F12 — `/booking/:cancellationToken`, `/reset-password/:token` and
 *   `/accept-invitation/:token` are named by the backend. `FrontendLinks` builds
 *   them into outbound mail, so a link sitting in an inbox from three weeks ago
 *   still has to resolve. Renaming one breaks messages already sent.
 */
export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      // --- Public -------------------------------------------------------
      {
        index: true,
        // `replace`, so the redirect does not sit in history and trap the back
        // button between `/` and `/b/demo-salon`.
        element: <Navigate to={`/b/${DEMO_SLUG}`} replace />,
      },
      {
        path: 'b/:slug',
        element: (
          <Placeholder
            eyebrow="Public"
            title="Business landing"
            wave="Wave 3"
            description="Services, prices and durations, and the entry point to the booking flow."
          />
        ),
      },
      {
        path: 'b/:slug/book',
        element: (
          <Placeholder
            eyebrow="Public"
            title="Book an appointment"
            wave="Wave 3"
            description="Service, then staff, then a slot the availability engine offered."
          />
        ),
      },
      {
        // Named by the backend (F12). Not ours to rename.
        path: 'booking/:cancellationToken',
        element: (
          <Placeholder
            eyebrow="Public"
            title="Manage your booking"
            wave="Wave 4"
            description="Reached from the confirmation email, and the page Stripe returns to."
          />
        ),
      },

      // --- Account ------------------------------------------------------
      {
        path: 'login',
        element: <Placeholder eyebrow="Account" title="Log in" wave="Wave 2" />,
      },
      {
        path: 'register',
        element: (
          <Placeholder
            eyebrow="Account"
            title="Create a business"
            wave="Wave 2"
            description="Self-registration ships (F17), so a reviewer gets their own empty tenant."
          />
        ),
      },
      {
        path: 'forgot-password',
        element: <Placeholder eyebrow="Account" title="Reset your password" wave="Wave 2" />,
      },
      {
        // Named by the backend (F12).
        path: 'reset-password/:token',
        element: <Placeholder eyebrow="Account" title="Choose a new password" wave="Wave 2" />,
      },
      {
        // Named by the backend (F12).
        path: 'accept-invitation/:token',
        element: <Placeholder eyebrow="Account" title="Join the team" wave="Wave 2" />,
      },

      // --- Admin --------------------------------------------------------
      // Bare paths, not /admin/*, so they read well in the portfolio
      // screenshots the brief asks for (§10).
      {
        path: 'dashboard',
        element: (
          <Placeholder
            eyebrow="Admin"
            title="Dashboard"
            wave="Wave 5"
            description="Today's bookings, the week's count, revenue and no-show rate."
          />
        ),
      },
      {
        path: 'calendar',
        element: (
          <Placeholder
            eyebrow="Admin"
            title="Calendar"
            wave="Wave 6"
            description="Week and day views. The brief's nominated cover image."
          />
        ),
      },
      {
        path: 'services',
        element: <Placeholder eyebrow="Admin" title="Services" wave="Wave 7" />,
      },
      {
        path: 'team',
        element: <Placeholder eyebrow="Admin" title="Team" wave="Wave 7" />,
      },
      {
        path: 'team/:id/hours',
        element: (
          <Placeholder
            eyebrow="Admin"
            title="Working hours"
            wave="Wave 8"
            description="A seven-row weekly grid, plus the exceptions calendar."
          />
        ),
      },
      {
        path: 'settings',
        element: (
          <Placeholder
            eyebrow="Admin"
            title="Settings"
            wave="Wave 8"
            description="Timezone, deposit rules and booking policy."
          />
        ),
      },

      // --- 404 ----------------------------------------------------------
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
