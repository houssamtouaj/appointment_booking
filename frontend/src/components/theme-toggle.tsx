import { Monitor, Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useTheme, type Theme } from '@/hooks/use-theme'

const ICON: Record<Theme, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
}

/**
 * One control, three states. The label says what pressing it will *do*, not what
 * the current state is — a button named "Dark" is ambiguous about whether that
 * is the state or the destination, and a screen-reader user gets no icon to
 * disambiguate it.
 */
const NEXT_LABEL: Record<Theme, string> = {
  system: 'Switch to light theme',
  light: 'Switch to dark theme',
  dark: 'Use system theme',
}

export function ThemeToggle() {
  const { theme, cycleTheme } = useTheme()
  const Icon = ICON[theme]

  return (
    <Button variant="ghost" size="icon-sm" onClick={cycleTheme} aria-label={NEXT_LABEL[theme]}>
      <Icon aria-hidden="true" />
    </Button>
  )
}
