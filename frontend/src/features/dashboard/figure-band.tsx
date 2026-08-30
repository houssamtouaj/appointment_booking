import { Skeleton } from '@/components/ui/skeleton'
import { FIGURES } from '@/features/dashboard/figures'
import { cn } from '@/lib/utils'
import type { DashboardStats } from '@/types'

type FigureBandProps = {
  /** Absent while the week is in flight. The labels and definitions show regardless. */
  stats?: DashboardStats
  currency: string
}

/**
 * The week's totals, ruled into a single band.
 *
 * Four cards with an icon in the corner is what every admin dashboard ships, and
 * it is not what an appointment book looks like. This is the summary a page in
 * one gets ruled across its head: cells divided by hairlines rather than floated
 * apart, figures set in the condensed signage face, and **each figure's
 * definition printed underneath it** — which is the point of the whole surface.
 * "Revenue earned" only means something if the sentence saying that bookings
 * still to come are not in it is on the same screen.
 *
 * The hairlines are a `gap-px` over a ruled ground rather than a border per
 * cell: borders double where two cells meet, and the alternative is per-cell
 * edge classes that have to know which column they landed in at each breakpoint.
 *
 * **Zero layout shift is structural here, not tuned.** The label and the
 * definition are static copy, so they render during loading too — the reader
 * learns what the number means while it arrives — and the only thing that
 * changes is what sits in a value slot of fixed height. There is no arrangement
 * of the loaded state that is taller than the loading one.
 */
export function FigureBand({ stats, currency }: FigureBandProps) {
  return (
    <section aria-labelledby="figures-heading">
      <h2 id="figures-heading" className="sr-only">
        Figures for the week shown
      </h2>

      {/* One live region for the whole band, rather than a "loading" per cell. */}
      <span className="sr-only" role="status">
        {stats ? '' : 'Loading this week’s figures'}
      </span>

      <dl className="border-border bg-rule grid gap-px overflow-hidden rounded-md border sm:grid-cols-2">
        {FIGURES.map((figure) => {
          const value = stats ? figure.format(stats, currency) : undefined
          return (
            <div
              key={figure.key}
              className={cn(
                'bg-card px-5 py-4',
                // The rate is a ratio derived from the counts above it, so it
                // closes the band as a full-width line rather than sitting in the
                // grid as if it were a fifth count.
                figure.key === 'noShowRate' && 'sm:col-span-2',
              )}
            >
              <dt className="text-muted-foreground text-2xs tracking-eyebrow flex h-4 items-center font-mono uppercase">
                {figure.label}
              </dt>
              <dd>
                {/* Fixed height, both states. 40px of display face and a 36px
                    shimmer both sit on the same baseline in a 44px slot, and so
                    does the sentence that replaces a figure there is no data
                    for — which is what makes zero layout shift structural here
                    rather than tuned. */}
                <span className="mt-1 flex h-11 items-end">
                  {value ? (
                    <span
                      className={cn(
                        value.kind === 'value'
                          ? // The figure is the headline of this screen, so it is set at
                            // the size the display face was chosen for. At 28px the
                            // condensed face reads as a caption sitting above its own
                            // explanation, which inverts the hierarchy of the tile.
                            'font-display text-display-md tracking-display text-foreground leading-none'
                          : 'text-muted-foreground text-sm',
                      )}
                    >
                      {value.text}
                    </span>
                  ) : (
                    <Skeleton className="h-9 w-28" />
                  )}
                </span>
                <span className="text-muted-foreground mt-1.5 block text-xs">
                  {figure.definition}
                </span>
              </dd>
            </div>
          )
        })}
      </dl>
    </section>
  )
}
