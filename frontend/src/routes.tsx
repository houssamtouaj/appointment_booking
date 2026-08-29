import { Navigate, type RouteObject } from 'react-router-dom'

import { RootLayout } from '@/components/root-layout'
import { BookingFlowPage } from '@/features/booking/booking-flow-page'
import { BusinessLandingPage } from '@/features/booking/business-landing-page'
import { AcceptInvitationPage } from '@/features/auth/accept-invitation-page'
import { ForgotPasswordPage } from '@/features/auth/forgot-password-page'
import { LoginPage } from '@/features/auth/login-page'
import { RegisterPage } from '@/features/auth/register-page'
import { ResetPasswordPage } from '@/features/auth/reset-password-page'
import { RequireAuth, RequireOwner } from '@/features/auth/route-guards'
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
      { path: 'b/:slug', element: <BusinessLandingPage /> },
      { path: 'b/:slug/book', element: <BookingFlowPage /> },
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
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      { path: 'forgot-password', element: <ForgotPasswordPage /> },
      {
        // Named by the backend (F12).
        path: 'reset-password/:token',
        element: <ResetPasswordPage />,
      },
      {
        // Named by the backend (F12).
        path: 'accept-invitation/:token',
        element: <AcceptInvitationPage />,
      },

      // --- Admin --------------------------------------------------------
      // Bare paths, not /admin/*, so they read well in the portfolio
      // screenshots the brief asks for (§10).
      //
      // Wave 2 adds the layout route around them. Nothing under here renders
      // until the bootstrap refresh has answered, which is what keeps a cold
      // load from opening with a burst of 401s.
      {
        element: <RequireAuth />,
        children: [
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
          // Services and Team are *shared* routes, not owner-only. F19 is about
          // actions: a staff member may read the catalogue and the roster and
          // may not create, edit or invite. Gating the whole route would hide
          // information they are allowed to see, so the check belongs on the
          // buttons, in the waves that add them.
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
            // The one route in the table that is owner-only end to end (F19):
            // business settings and the booking policy have no staff-readable
            // half.
            element: <RequireOwner />,
            children: [
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
            ],
          },
        ],
      },

      // --- 404 ----------------------------------------------------------
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
