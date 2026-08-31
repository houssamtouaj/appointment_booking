import { Check, ChevronDown, ExternalLink, LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DropdownMenu } from 'radix-ui'
import { toast } from 'sonner'

import { Monogram } from '@/components/monogram'
import { useAuth } from '@/features/auth/use-auth'
import { useTheme, type Theme } from '@/hooks/use-theme'
import type { MeResponse } from '@/types'

/**
 * Who is signed in, and the three things they can do about it: change the theme,
 * look at their own booking page, leave.
 *
 * A menu rather than a row of buttons because the admin header has a business
 * name in it that can be arbitrarily long, and three controls competing with it
 * at 375px is how a header stops being readable. The theme control is a radio
 * group here rather than the public header's cycling button: inside a menu there
 * is room to name all three states, and "follow the system" is a state worth
 * being able to pick directly rather than cycling past.
 */
export function AccountMenu({ user }: { user: MeResponse }) {
  const { signOut } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const [leaving, setLeaving] = useState(false)

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="text-foreground hover:bg-accent flex items-center gap-2 rounded-sm py-1 pr-1.5 pl-1 text-sm transition-colors"
        aria-label={`Account: ${user.fullName}`}
      >
        <Monogram fullName={user.fullName} size="md" />
        <span className="hidden max-w-[12ch] truncate sm:inline">{user.fullName}</span>
        <ChevronDown className="text-muted-foreground size-3.5" aria-hidden="true" />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="bg-popover text-popover-foreground border-border shadow-e2 z-50 w-64 rounded-md border p-1.5"
        >
          <div className="px-2.5 py-2">
            <p className="text-foreground truncate text-sm font-medium">{user.fullName}</p>
            <p className="text-muted-foreground truncate text-xs">{user.email}</p>
            <p className="text-muted-foreground text-2xs tracking-eyebrow mt-1.5 font-mono uppercase">
              {user.role === 'OWNER' ? 'Owner' : 'Staff'} · {user.business.name}
            </p>
          </div>

          <Separator />

          <p className="text-muted-foreground text-2xs tracking-eyebrow px-2.5 pt-1.5 pb-1 font-mono uppercase">
            Theme
          </p>
          <DropdownMenu.RadioGroup value={theme} onValueChange={(next) => setTheme(next as Theme)}>
            {THEMES.map(({ value, label, icon: Icon }) => (
              <DropdownMenu.RadioItem
                key={value}
                value={value}
                className="text-foreground data-[highlighted]:bg-accent flex cursor-default items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-sm outline-none"
              >
                <Icon className="text-muted-foreground size-4" aria-hidden="true" />
                {label}
                <DropdownMenu.ItemIndicator className="ml-auto">
                  <Check className="text-primary size-4" aria-hidden="true" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>

          <Separator />

          <DropdownMenu.Item asChild>
            <Link
              to={`/b/${user.business.slug}`}
              className="text-foreground data-[highlighted]:bg-accent flex cursor-default items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-sm outline-none"
            >
              <ExternalLink className="text-muted-foreground size-4" aria-hidden="true" />
              View booking page
            </Link>
          </DropdownMenu.Item>

          <Separator />

          <DropdownMenu.Item
            disabled={leaving}
            onSelect={async (event) => {
              // The menu closes on select and unmounts this handler's owner with
              // it, so the await has to survive that — hence the guard rather
              // than any state read after it.
              event.preventDefault()
              setLeaving(true)
              try {
                await signOut()
                toast.success('Signed out')
                navigate('/login', { replace: true })
              } finally {
                setLeaving(false)
              }
            }}
            className="text-foreground data-[highlighted]:bg-accent flex cursor-default items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-sm outline-none data-[disabled]:opacity-50"
          >
            <LogOut className="text-muted-foreground size-4" aria-hidden="true" />
            {leaving ? 'Signing out…' : 'Sign out'}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

const THEMES = [
  { value: 'system', label: 'Match system', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const

function Separator() {
  return <DropdownMenu.Separator className="bg-rule my-1.5 h-px" />
}
