import { cn } from '@/lib/utils'

type ContainerProps = React.ComponentProps<'div'> & {
  /**
   * `app` is the admin width (1216px). `copy` is the narrow one (704px) used by
   * public copy and by the booking form — a form field wider than that is harder
   * to scan, not easier to fill.
   *
   * Not called `prose`: that word is Tailwind's, and a `max-w-prose` utility it
   * already owns statically would shadow the token this resolves to. See the
   * note on --container-copy in styles/theme.css.
   */
  width?: 'app' | 'copy'
}

/**
 * The only place horizontal page padding is decided. 16px at 375px, 24px above
 * it: the gutter has to stay a thumb's width from the edge on a phone, which is
 * where the booking flow is actually used.
 */
export function Container({ width = 'app', className, ...props }: ContainerProps) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-4 sm:px-6',
        width === 'app' ? 'max-w-app' : 'max-w-copy',
        className,
      )}
      {...props}
    />
  )
}
