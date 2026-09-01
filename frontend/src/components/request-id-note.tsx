import { cn } from '@/lib/utils'

type RequestIdNoteProps = {
  /** `X-Request-Id` from the failed response. Renders nothing when absent. */
  requestId?: string
  /** Spacing, which is the only thing the two call sites disagree about. */
  className?: string
}

/**
 * "Reference `<id>`", selectable, in one place.
 *
 * Both surfaces that report a failure to a person show this — `ErrorState` for a
 * whole screen, `FormAlert` for one form — and the markup was byte-identical in
 * the two, down to the `select-all` that lets somebody quote it without a
 * careful drag. One component so the pair cannot drift: an id that is
 * copy-pastable in a dialog and not on a page is worse than either.
 */
export function RequestIdNote({ requestId, className }: RequestIdNoteProps) {
  if (!requestId) return null
  return (
    <p className={cn('text-muted-foreground text-xs', className)}>
      Reference{' '}
      <code className="text-foreground bg-muted rounded-xs px-1.5 py-0.5 font-mono select-all">
        {requestId}
      </code>
    </p>
  )
}
