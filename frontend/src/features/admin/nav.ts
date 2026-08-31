import { CalendarDays, Clock, Gauge, Settings2, Tag, Users, type LucideIcon } from 'lucide-react'

import type { MeResponse } from '@/types'

/**
 * The nav matrix (F19), as data rather than as five conditionals in the markup.
 *
 * **The nav is the courtesy; `RequireOwner` is the permission.** Both, never
 * either. A hidden link stops a staff member walking into a screen that would
 * only tell them no — which is worth doing, because the demo is logged into both
 * roles and a `403` looks like a bug the moment it is reachable by clicking. But
 * hiding is not enforcement: the URL is still typeable, the router still has to
 * refuse it, and the backend refuses it a third time with `@PreAuthorize`.
 *
 * The table below is the wave plan's, and one row of it is not what it looks
 * like:
 *
 * | Item          | OWNER | STAFF                                   |
 * |---------------|-------|-----------------------------------------|
 * | Dashboard     | yes   | yes — their own figures, same endpoint  |
 * | Calendar      | yes   | yes — the **whole** business            |
 * | Services      | yes   | hidden                                  |
 * | Team          | yes   | replaced by their own working hours     |
 * | Settings      | yes   | hidden                                  |
 *
 * Calendar is deliberately not scoped. A receptionist books for everyone, so a
 * staff member who could only see their own column would be unable to do the job
 * the screen exists for — and the API agrees: `GET /api/bookings` is not role
 * -scoped, only the dashboard's aggregate is.
 *
 * Services and Team are **not** merely unlinked for staff — from wave 7 they are
 * owner-only routes and a staff member typing either URL is redirected with an
 * explanation (`routes.tsx` records why that changed from wave 1's shared
 * routes). So this table and the router agree rather than one being the
 * courtesy and the other the permission — which they still are for the rows
 * above, where the hidden link and the real check are different things.
 */
export type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  /**
   * Exact-match the path. Only `/dashboard` needs it today; it is on the type so
   * that wave 7 adding `/team/invite` does not light up `Team` and its child at
   * once.
   */
  end?: boolean
}

export function navItemsFor(user: MeResponse): NavItem[] {
  const shared: NavItem[] = [
    { to: '/dashboard', label: 'Dashboard', icon: Gauge, end: true },
    { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  ]

  if (user.role === 'OWNER') {
    return [
      ...shared,
      { to: '/services', label: 'Services', icon: Tag },
      { to: '/team', label: 'Team', icon: Users },
      { to: '/settings', label: 'Settings', icon: Settings2 },
    ]
  }

  return [
    ...shared,
    // `me.id` is the staff id. Staff *are* users in this API — the dashboard
    // scopes its figures by `tenant.userId()` and `StaffResponse.id` is the same
    // column — so there is no second identifier to look up and no request to
    // make before the nav can be rendered.
    { to: `/team/${user.id}/hours`, label: 'Working hours', icon: Clock },
  ]
}
