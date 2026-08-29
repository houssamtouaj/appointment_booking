import { Toaster as Sonner } from 'sonner'

import { useTheme } from '@/hooks/use-theme'

/**
 * Mounted exactly once, in the root layout. Rule 4 of the overview: every
 * mutation produces a toast, success and failure both, and a failure carries the
 * request id — so this has to exist on every route, not per feature.
 *
 * Sonner renders into a portal with its own stylesheet, which is the one place
 * in the app that would otherwise ship shadcn-adjacent defaults. Pointing its
 * CSS variables at ours is what keeps a toast looking like the rest of the page
 * in both themes.
 */
export function Toaster() {
  const { theme } = useTheme()

  return (
    <Sonner
      // Sonner needs to be told; it cannot read a [data-theme] attribute. Passing
      // "system" hands it back to prefers-color-scheme, which is the same rule
      // the tokens follow.
      theme={theme}
      position="bottom-right"
      // Toasts are announcements, not decoration: close button always available,
      // and rich colours off because our own tokens supply them below.
      closeButton
      toastOptions={{
        style: {
          background: 'var(--card)',
          color: 'var(--card-foreground)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--elevation-2)',
          fontFamily: 'var(--font-body)',
          fontSize: 'var(--text-sm)',
        },
      }}
    />
  )
}
