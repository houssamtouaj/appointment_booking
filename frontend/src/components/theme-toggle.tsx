import { Monitor, Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useTheme, type Theme } from '@/hooks/use-theme'
import { useTranslation, type TKey } from '@/i18n'

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
 *
 * **Keys and not sentences.** This map is built once at module scope, so three
 * sentences here would be captured in whatever language the tab was loaded in
 * and would then survive a language switch — on the very control that sits
 * beside the language switcher.
 */
const NEXT_LABEL: Record<Theme, TKey> = {
  system: 'components.themeToggle.toLight',
  light: 'components.themeToggle.toDark',
  dark: 'components.themeToggle.toSystem',
}

export function ThemeToggle() {
  const { theme, cycleTheme } = useTheme()
  const { t } = useTranslation()
  const Icon = ICON[theme]

  return (
    <Button variant="ghost" size="icon-sm" onClick={cycleTheme} aria-label={t(NEXT_LABEL[theme])}>
      <Icon aria-hidden="true" />
    </Button>
  )
}
