import { Menu, X } from 'lucide-react'
import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { Dialog } from 'radix-ui'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AccountMenu } from '@/features/admin/account-menu'
import { AdminNav } from '@/features/admin/admin-nav'
import { useAuth } from '@/hooks/use-auth'
import type { MeResponse } from '@/types'

/**
 * The shell every admin screen hangs on: a persistent rail at ≥ 1024px, a drawer
 * behind a menu button below it, and a header that says which business you are
 * looking at and who you are looking at it as.
 *
 * **It sits *above* `RequireAuth` in the route table, not below it**, and that
 * ordering is the whole reason this component reads the session itself:
 *
 * - While the bootstrap is in flight, the shell renders with skeleton rows in
 *   the rail. Below the guard it could not — `RequireAuth` renders its own
 *   placeholder instead of an `<Outlet />` — and a cold load would then paint a
 *   bare page and grow a sidebar a round trip later. That jump is the reflow F20
 *   exists to prevent, on the one screen every session starts at.
 * - For an anonymous visitor it renders **nothing but the outlet**, so the
 *   redirect inside `RequireAuth` happens without a frame of admin chrome
 *   flashing at somebody who is on their way to the login screen.
 */
export function AdminLayout() {
  const { status, user } = useAuth()

  // `RequireAuth` is the child; it redirects. Rendering the rail around a
  // <Navigate> would show a signed-out visitor the inside of the product.
  if (status === 'anonymous') return <Outlet />

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <Sidebar user={user} />

      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="border-rule bg-background/85 sticky top-0 z-30 border-b backdrop-blur">
          <div className="flex h-[var(--header-height)] items-center gap-2 px-4 sm:px-6">
            {user ? <MobileNav user={user} /> : null}

            {/* The wordmark is in the rail at ≥1024px and in the header below it,
                where there is no rail to put it in. */}
            <Link
              to="/dashboard"
              className="font-display text-foreground tracking-display text-xl leading-none lg:hidden"
            >
              Slotflow
            </Link>

            {/* A div, not a <p>: the loading state puts a Skeleton — itself a
                div — in this slot, and a <p> may not contain one. */}
            <div className="text-muted-foreground hidden min-w-0 truncate text-sm lg:block">
              {user ? user.business.name : <Skeleton className="h-3.5 w-32" />}
            </div>

            <div className="ml-auto flex items-center gap-1">
              {user ? <AccountMenu user={user} /> : <Skeleton className="size-7 rounded-full" />}
            </div>
          </div>
        </header>

        <main id="main" className="flex-1 pb-16">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

/**
 * The rail. `sticky` at the top of a `h-dvh` column rather than `fixed`, so it
 * participates in the grid and the content column needs no compensating margin
 * — a margin and a width that have to agree is a pair that stops agreeing.
 */
function Sidebar({ user }: { user: MeResponse | null }) {
  return (
    <aside className="border-rule bg-card sticky top-0 hidden h-dvh flex-col border-r lg:flex">
      <div className="border-rule flex h-[var(--header-height)] shrink-0 items-center border-b px-5">
        <Link
          to="/dashboard"
          className="font-display text-foreground tracking-display text-xl leading-none"
        >
          Slotflow
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto">
        {user ? <AdminNav user={user} /> : <NavSkeleton />}
      </div>

      {user ? (
        <div className="border-rule shrink-0 border-t px-5 py-4">
          <p className="text-muted-foreground text-2xs tracking-eyebrow font-mono uppercase">
            Booking page
          </p>
          <Link
            to={`/b/${user.business.slug}`}
            className="text-primary mt-1 block truncate text-sm underline-offset-4 hover:underline"
          >
            /b/{user.business.slug}
          </Link>
        </div>
      ) : null}
    </aside>
  )
}

/**
 * The drawer, at the same width as the rail it replaces.
 *
 * **Closed by the navigation itself, not by an effect watching for one.** The
 * obvious version closes it in an effect on the location, which is a `setState`
 * inside an effect — a cascading render, and the thing
 * `react-hooks/set-state-in-effect` is right to refuse. Adjusting the state
 * during render instead is the sanctioned form, and it closes the drawer for
 * every kind of navigation for free: a link, a redirect, and the back button,
 * which the effect version handles only by accident.
 *
 * It keys on `location.key` and not on the pathname, because a pathname is not
 * unique to a moment in history. Deriving `open` as "still on the page it was
 * opened on" reads correctly and re-opens the drawer by itself the next time
 * that path comes back — dismiss it with the Android back button on
 * `/dashboard`, then return to `/dashboard`, and a sheet nobody asked for
 * slides in. A history entry is visited once, so it cannot do that.
 *
 * `onNavigate` is still passed down, and covers the one case this cannot:
 * tapping the row for the page you are already on, where React Router pushes
 * nothing and a drawer left standing would look broken.
 */
function MobileNav({ user }: { user: MeResponse }) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [entry, setEntry] = useState(location.key)

  if (entry !== location.key) {
    setEntry(location.key)
    if (open) setOpen(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Open menu">
          <Menu aria-hidden="true" />
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="bg-scrim fixed inset-0 z-50" />
        <Dialog.Content
          // No description: the drawer is a list of links and Radix warns about
          // the missing one unless it is explicitly told there is none.
          aria-describedby={undefined}
          className="bg-card border-rule fixed inset-y-0 left-0 z-50 flex w-[15rem] flex-col border-r"
        >
          <div className="border-rule flex h-[var(--header-height)] shrink-0 items-center justify-between border-b pr-2 pl-5">
            <Dialog.Title className="font-display text-foreground tracking-display text-xl leading-none">
              Slotflow
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close menu">
                <X aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto">
            <AdminNav user={user} onNavigate={() => setOpen(false)} />
          </div>

          <div className="border-rule shrink-0 border-t px-5 py-4">
            <p className="text-muted-foreground text-2xs tracking-eyebrow font-mono uppercase">
              Booking page
            </p>
            <Link
              to={`/b/${user.business.slug}`}
              onClick={() => setOpen(false)}
              className="text-primary mt-1 block truncate text-sm underline-offset-4 hover:underline"
            >
              /b/{user.business.slug}
            </Link>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * The rail during the bootstrap. Five rows, because five is what an owner sees
 * and a rail that grows from three to five when the session lands is the jump
 * this is here to avoid — a staff member's shorter list settles *shorter*, which
 * moves nothing below it.
 */
function NavSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-0.5 px-3 py-4">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 py-2 pr-3 pl-4">
          <Skeleton className="size-4" />
          <Skeleton className="h-3.5 w-24" />
        </div>
      ))}
    </div>
  )
}
