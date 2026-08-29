import { cn } from '@/lib/utils'

/**
 * A plain `<label>`, not Radix's.
 *
 * Radix's Label exists to make clicking one focus a non-native control. Every
 * control in this app is a native input or a Radix primitive that already
 * handles its own labelling, so the dependency would buy nothing and add a
 * component boundary to every field.
 */
export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    // The rule wants to see `htmlFor` or a nested control here, and cannot: this
    // is the generic atom, and the association is made by whoever renders it.
    // `FormField` is what guarantees it — its render-prop shape makes the id
    // impossible to reach without also passing it to the control — and the
    // wiring is asserted in `form-field.test.tsx`.
    // eslint-disable-next-line jsx-a11y/label-has-associated-control
    <label
      data-slot="label"
      className={cn(
        'text-foreground text-sm leading-none font-medium select-none',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
