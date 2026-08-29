import { cn } from '@/lib/utils'

/**
 * shadcn's input, with the same three departures the button makes.
 *
 * No `ring-*` and no `outline-none`: the app has exactly one focus treatment,
 * declared on `:focus-visible` in index.css. `rounded-sm`, because that is the
 * 6px step the radius scale gives to controls. And `border-input` rather than
 * `border-border` — an input's edge is a target you aim at, so it uses the
 * darker of the two rules (theme.css, `--input`).
 *
 * `aria-invalid` is the error state rather than a prop: React Hook Form already
 * knows which fields failed, `FormField` puts the attribute on, and a styling
 * hook that rides the same attribute a screen reader reads cannot drift out of
 * step with it.
 */
export function Input({ className, type = 'text', ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'border-input bg-card text-foreground flex h-9 w-full rounded-sm border px-3 py-1 text-sm',
        'placeholder:text-muted-foreground',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive',
        // A file input has no text baseline to align, and the date pickers'
        // indicators inherit the wrong colour in dark mode without this.
        'file:text-foreground file:border-0 file:bg-transparent file:text-sm file:font-medium',
        '[&::-webkit-calendar-picker-indicator]:opacity-60 dark:[&::-webkit-calendar-picker-indicator]:invert',
        className,
      )}
      {...props}
    />
  )
}
