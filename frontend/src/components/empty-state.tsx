import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

type EmptyStateProps = {
  icon: LucideIcon
  /** One sentence. What is not here, and why that is expected. */
  title: string
  /** One more sentence at most. What to do about it. */
  description?: string
  /** Exactly one action. Two actions is a screen that has not decided. */
  action?: React.ReactNode
  className?: string
}

/**
 * The empty half of rule 5 — every list ships skeleton, empty and error before
 * it ships the happy path.
 *
 * An empty screen is an invitation, so the copy names the next step rather than
 * reporting a count of zero. The ruled ground behind it is the blank page of the
 * appointment book, which is literally what an empty list here is.
 */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'border-border bg-card relative overflow-hidden rounded-md border px-6 py-14 text-center',
        className,
      )}
    >
      <div
        className="ruled-paper pointer-events-none absolute inset-0 opacity-60"
        aria-hidden="true"
      />

      <div className="relative flex flex-col items-center">
        <span className="bg-primary-wash text-primary mb-4 inline-flex size-10 items-center justify-center rounded-sm">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <p className="text-foreground text-base font-medium">{title}</p>
        {description ? (
          <p className="text-muted-foreground max-w-copy mt-1 text-sm">{description}</p>
        ) : null}
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
    </div>
  )
}
