import { cn } from '@/lib/utils'

/**
 * The `Input` atom's sibling, and deliberately identical everywhere it can be:
 * same border token, same radius, same `aria-invalid` hook, no ring of its own
 * — the app has exactly one focus treatment, declared on `:focus-visible` in
 * index.css.
 *
 * `field-sizing-content` lets it grow with what is typed, with `min-h` holding
 * the initial geometry so the page does not reflow when the first character
 * lands. Browsers without it get a fixed three-line box, which is the behaviour
 * a textarea has always had.
 */
export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'border-input bg-card text-foreground flex min-h-20 w-full rounded-sm border px-3 py-2 text-sm',
        'placeholder:text-muted-foreground field-sizing-content',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  )
}
