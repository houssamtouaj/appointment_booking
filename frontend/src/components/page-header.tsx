import { cn } from '@/lib/utils'

type PageHeaderProps = {
  /**
   * The 11px tracked-out label above the title. It should say where you are in
   * the product ("Calendar", "Team"), never repeat the title, and never be
   * decorative — if there is nothing true to put here, leave it out.
   */
  eyebrow?: string
  title: string
  description?: string
  /** Primary action for the page, right-aligned above 640px and stacked below it. */
  actions?: React.ReactNode
  className?: string
}

/**
 * Every screen opens with one of these, so that "where am I and what can I do
 * here" is answered in the same place on all nine of them.
 *
 * The rule underneath is the signature motif: a hairline that reads as the top
 * line of a ruled page, with a short accent segment where the writing starts.
 * It is the one piece of decoration in the component and it earns its place by
 * being the same device the calendar's hour lines use.
 */
export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('pt-8 pb-6', className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-muted-foreground text-2xs tracking-eyebrow mb-1 font-mono uppercase">
              {eyebrow}
            </p>
          ) : null}
          {/* Condensed display face: a tenant's business name can be arbitrarily
              long and still has to hold one line at 375px. */}
          <h1 className="font-display text-display-sm text-foreground tracking-display truncate leading-tight">
            {title}
          </h1>
          {description ? (
            <p className="text-muted-foreground mt-2 max-w-prose text-sm">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>

      {/* The ruled line. The accent segment marks the left margin of the page,
          the way the red rule does on a ledger. */}
      <div className="mt-5 flex items-center" aria-hidden="true">
        <span className="bg-primary h-px w-10 shrink-0" />
        <span className="bg-rule h-px flex-1" />
      </div>
    </header>
  )
}
