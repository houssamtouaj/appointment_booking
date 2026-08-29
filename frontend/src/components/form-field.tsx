import { useId } from 'react'

import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

type FormFieldProps = {
  label: string
  /** Standing help — the slug rule, the password minimum. Not the error. */
  hint?: string
  /** From `formState.errors.<name>?.message`, server-set or client-set alike. */
  error?: string
  /** Called with the ids and state the control must carry. */
  children: (control: {
    id: string
    'aria-describedby': string | undefined
    'aria-invalid': boolean
  }) => React.ReactNode
  className?: string
}

/**
 * Label, control, hint and error, wired together.
 *
 * The wiring is the reason this exists rather than three lines per field. Every
 * one of the following is easy to forget once and impossible to notice
 * afterwards, and forgetting any of them means the field is fine for a sighted
 * mouse user and broken for everybody else:
 *
 * - `htmlFor`/`id`, so clicking the label focuses the control and a screen
 *   reader announces the two together;
 * - `aria-describedby` naming **both** the hint and the error, so the rule and
 *   what went wrong are read out, not just one of them;
 * - `aria-invalid`, which is what a screen reader uses to say "invalid entry"
 *   and, here, also what draws the red edge (`ui/input.tsx`);
 * - `role="alert"` on the message, so an error that appears after submit is
 *   announced instead of sitting there silently.
 *
 * The render-prop shape is what makes those non-optional: there is no way to use
 * this component and skip them, because the ids only exist inside the callback.
 */
export function FormField({ label, hint, error, children, className }: FormFieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ')

  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        'aria-describedby': describedBy || undefined,
        'aria-invalid': Boolean(error),
      })}
      {hint ? (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  )
}
