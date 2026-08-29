import { AlertTriangle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ErrorStateProps = {
  /**
   * What went wrong, in the interface's voice. Errors do not apologise and are
   * never vague: "This calendar could not be loaded", not "Oops, something went
   * wrong". From wave 2 this is chosen by `ApiError.code` (F13), falling back to
   * the server's `detail`.
   */
  title: string
  description?: string
  /**
   * The `X-Request-Id` from the failed response. Every backend response carries
   * one, and it is the only thing that turns a user's report into a log query —
   * so it is shown, selectable, rather than logged to a console nobody opens.
   */
  requestId?: string
  onRetry?: () => void
  className?: string
}

/**
 * The error half of rule 5. Paired with EmptyState so that the two failure
 * surfaces of every list look like siblings.
 */
export function ErrorState({ title, description, requestId, onRetry, className }: ErrorStateProps) {
  return (
    <div
      // `alert` rather than `status`: this interrupts, and a screen reader should
      // hear it without waiting for the user to arrive at it.
      role="alert"
      className={cn('border-border bg-card rounded-md border px-6 py-12 text-center', className)}
    >
      <div className="flex flex-col items-center">
        <span className="bg-danger-wash text-danger mb-4 inline-flex size-10 items-center justify-center rounded-sm">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </span>
        <p className="text-foreground text-base font-medium">{title}</p>
        {description ? (
          <p className="text-muted-foreground mt-1 max-w-prose text-sm">{description}</p>
        ) : null}

        {onRetry ? (
          <Button variant="outline" size="sm" className="mt-5" onClick={onRetry}>
            Try again
          </Button>
        ) : null}

        {requestId ? (
          <p className="text-muted-foreground mt-5 text-xs">
            Reference{' '}
            <code className="text-foreground bg-muted rounded-xs px-1.5 py-0.5 font-mono select-all">
              {requestId}
            </code>
          </p>
        ) : null}
      </div>
    </div>
  )
}
