import { cn } from '@/lib/utils'

/**
 * The skeleton *atom* — a single shimmering block. It is deliberately not a
 * page loader.
 *
 * F20: skeletons mirror the layout they replace, and there is no shared generic
 * spinner or full-page loader anywhere in this app. Each surface composes its
 * own skeleton out of this atom, in the wave that owns the surface, so that the
 * placeholder holds the same geometry as the content and the page does not
 * reflow when data lands. A generic one cannot do that, and reintroduces the
 * jump it was meant to remove.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      // aria-hidden: a screen reader should hear the live region that announces
      // "loading", not a run of empty boxes.
      aria-hidden="true"
      className={cn('bg-muted animate-pulse rounded-xs', className)}
      {...props}
    />
  )
}

export { Skeleton }
