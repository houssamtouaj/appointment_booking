import { NavLink } from 'react-router-dom'

import { navItemsFor } from '@/features/admin/nav'
import { cn } from '@/lib/utils'
import type { MeResponse } from '@/types'
import { useTranslation } from '@/i18n'

type AdminNavProps = {
  user: MeResponse
  /** Closes the drawer. Absent in the persistent sidebar, where there is nothing to close. */
  onNavigate?: () => void
}

/**
 * The nav rows, shared verbatim by the sidebar and the drawer.
 *
 * One component and not two, because the mobile menu differing from the desktop
 * one by a role check nobody remembered to copy is exactly the class of bug F19
 * is about.
 *
 * The active row carries a **margin mark**: a short green rule down its left
 * edge, in the colour the appointments were written in. It is the same device as
 * the ruled line under every page title and the hour lines on the calendar —
 * this app marks position with rules, not with pills. `aria-current="page"`
 * comes from `NavLink` for free, so the state is announced as well as drawn, and
 * the fill behind it is `--primary-wash`, which the token file reserves for
 * exactly two things: a selected slot and an active nav row.
 */
export function AdminNav({ user, onNavigate }: AdminNavProps) {
  const { t } = useTranslation()
  return (
    <nav aria-label={t('nav.sections')} className="px-3 py-4">
      <ul className="space-y-0.5">
        {navItemsFor(user).map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'relative flex items-center gap-3 rounded-sm py-2 pr-3 pl-4 text-sm transition-colors',
                  isActive
                    ? 'bg-primary-wash text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-xs',
                      isActive ? 'bg-primary' : 'bg-transparent',
                    )}
                  />
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{t(label)}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
