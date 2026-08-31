import { Navigate, type RouteObject } from 'react-router-dom'

import { PublicLayout } from '@/components/public-layout'
import { RootLayout } from '@/components/root-layout'
import { AdminLayout } from '@/features/admin/admin-layout'
import { CalendarPage } from '@/features/calendar/calendar-page'
import { DashboardPage } from '@/features/dashboard/dashboard-page'
import { BookingFlowPage } from '@/features/booking/booking-flow-page'
import { BusinessLandingPage } from '@/features/booking/business-landing-page'
import { ManageBookingPage } from '@/features/booking/manage-booking-page'
import { AcceptInvitationPage } from '@/features/auth/accept-invitation-page'
import { ForgotPasswordPage } from '@/features/auth/forgot-password-page'
import { LoginPage } from '@/features/auth/login-page'
import { RegisterPage } from '@/features/auth/register-page'
import { ResetPasswordPage } from '@/features/auth/reset-password-page'
import { RequireAuth, RequireOwner } from '@/features/auth/route-guards'
import { ServicesPage } from '@/features/services/services-page'
import { TeamPage } from '@/features/staff/team-page'
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
 *
 * Wave 5 split the chrome in two. `RootLayout` is now the frame — skip link,
 * toaster, debug panel — and the two branches below choose their own header:
 * `PublicLayout` for anything a stranger can reach, `AdminLayout` for the shell.
 * Nesting the admin shell inside the old single layout put two headers on every
 * admin screen, and giving the admin branch its own root would have duplicated
 * the frame instead.
 */
export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      {
        // Everything a stranger can reach, plus the four account screens: thin
        // header, no nav rail, a footer.
        element: <PublicLayout />,
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
            // Named by the backend (F12). Not ours to rename: `FrontendLinks` builds
            // this path into every customer email, and it is also the URL Stripe
            // returns to with `?checkout=success|cancelled`.
            path: 'booking/:cancellationToken',
            element: <ManageBookingPage />,
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

          // --- 404 ----------------------------------------------------------
          // A splat outranks nothing: React Router ranks by specificity rather
          // than by order, so `/dashboard` still wins over this.
          { path: '*', element: <NotFoundPage /> },
        ],
      },

      // --- Admin --------------------------------------------------------
      // Bare paths, not /admin/*, so they read well in the portfolio
      // screenshots the brief asks for (§10).
      //
      // `AdminLayout` wraps `RequireAuth` rather than the other way round, so the
      // shell is on screen — with skeleton nav rows — while the bootstrap
      // refresh is in flight, instead of appearing a round trip after the page
      // does. It renders nothing but the outlet for an anonymous visitor, so the
      // redirect below still happens without a flash of the product's insides.
      {
        element: <AdminLayout />,
        children: [
          {
            element: <RequireAuth />,
            children: [
              { path: 'dashboard', element: <DashboardPage /> },
              { path: 'calendar', element: <CalendarPage /> },
              {
                // A staff member's own working hours, and the one route under
                // `/team` that is **not** owner-only: their nav links straight
                // here (`features/admin/nav.ts`), so it is the screen `/team`
                // is replaced by for them rather than a child of it.
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
                // The owner-only branch (F19).
                //
                // **Services and Team moved in here in wave 7, and that is a
                // change of mind worth recording.** Wave 1 made them shared
                // routes on a reasonable argument: F19 is about actions, a staff
                // member may *read* the catalogue and the roster, and gating the
                // whole route hides information they are allowed to see — so the
                // check belonged on the buttons.
                //
                // Wave 7's plan settles it the other way, and its demo is
                // explicit: signed in as a seeded `STAFF` account, neither screen
                // is in the nav *and both URLs redirect*. Two things decided it
                // once the screens were real. Every control on both of them is a
                // write — there is no read-only version of "invite", "assign",
                // "deactivate" — so a staff member's version of either screen
                // would be a list with every button disabled, which is a worse
                // answer than a redirect. And the roster carries every
                // colleague's email address, which is an owner's view of their
                // team rather than a directory.
                //
                // `settings` was always here: business settings and the booking
                // policy have no staff-readable half at all.
                element: <RequireOwner />,
                children: [
                  { path: 'services', element: <ServicesPage /> },
                  { path: 'team', element: <TeamPage /> },
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
        ],
      },
    ],
  },
]
