import { Check, ChevronDown, ExternalLink, LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { Link } from 'react-router-dom'
import { DropdownMenu } from 'radix-ui'

import { Monogram } from '@/components/monogram'
import { useSignOut } from '@/hooks/use-sign-out'
import { isTheme, useTheme } from '@/hooks/use-theme'
import { useLanguage, useTranslation } from '@/i18n'
import { isLanguage, setLanguage } from '@/i18n/language'
import type { MeResponse } from '@/types'

/**
 * Who is signed in, and the four things they can do about it: change the
 * language, change the theme, look at their own booking page, leave.
 *
 * A menu rather than a row of buttons because the admin header has a business
 * name in it that can be arbitrarily long, and three controls competing with it
 * at 375px is how a header stops being readable. The theme control is a radio
 * group here rather than the public header's cycling button: inside a menu there
 * is room to name all three states, and "follow the system" is a state worth
 * being able to pick directly rather than cycling past. The language control is
 * a radio group for the same reason and one more (F24): inside a menu there is
 * room to name both languages, where the header only has room for two letters.
 */
export function AccountMenu({ user }: { user: MeResponse }) {
  const { theme, setTheme } = useTheme()
  const { leave, leaving } = useSignOut()
  const { t } = useTranslation()
  const language = useLanguage()

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
            {t('language.groupLabel')}
          </p>
          <DropdownMenu.RadioGroup
            value={language}
            onValueChange={(next) => {
              if (isLanguage(next)) setLanguage(next)
            }}
          >
            {LANGUAGES.map(({ value, label }) => (
              <DropdownMenu.RadioItem
                key={value}
                value={value}
                className="text-foreground data-[highlighted]:bg-accent flex cursor-default items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-sm outline-none"
              >
                {label}
                <DropdownMenu.ItemIndicator className="ml-auto">
                  <Check className="text-primary size-4" aria-hidden="true" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>

          <Separator />

          <p className="text-muted-foreground text-2xs tracking-eyebrow px-2.5 pt-1.5 pb-1 font-mono uppercase">
            Theme
          </p>
          <DropdownMenu.RadioGroup
            value={theme}
            onValueChange={(next) => {
              if (isTheme(next)) setTheme(next)
            }}
          >
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
            onSelect={(event) => {
              // The menu closes on select and would unmount this handler's owner
              // mid-await; `preventDefault` keeps it open until the round trip
              // has finished and the navigation has happened.
              event.preventDefault()
              void leave()
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

/**
 * Each language named in itself, never translated. "Français" does not become
 * "French" when the interface is English — the whole point of this row is to be
 * findable by somebody who cannot read the language currently on screen. It is
 * also simply the convention every language picker follows.
 *
 * No icons, unlike THEMES: there is no icon for a language, which is the same
 * conclusion `language-toggle.tsx` reaches about globes and flags.
 */
const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
] as const

const THEMES = [
  { value: 'system', label: 'Match system', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const

function Separator() {
  return <DropdownMenu.Separator className="bg-rule my-1.5 h-px" />
}
