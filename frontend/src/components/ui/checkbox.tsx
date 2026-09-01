import { cn } from '@/lib/utils'

/**
 * A checkbox, and deliberately the native one.
 *
 * `components/ui/` had `Input`, `Label`, `Textarea` and `Skeleton` and no
 * checkbox, so four call sites hand-styled a raw `<input type="checkbox">` —
 * three of them repeating `border-input accent-primary size-4 rounded-xs border`
 * verbatim. Four is where that starts to cost.
 *
 * Not Radix's, though `radix-ui` is already a dependency and the account menu
 * uses its dropdown. A Radix checkbox is a `<button role="checkbox">` with a
 * hidden input, which buys a styleable tick and costs the two things these call
 * sites use: `{...form.register('wholeDay')}` spreading straight onto a real
 * input, and the platform's own behaviour inside a `<label>` wrapper. `accent-color`
 * gets the tick into the brand colour without giving any of that up.
 *
 * `aria-invalid` rides the attribute the way `Input` does, so a checkbox in a
 * failed group marks itself with no extra prop.
 */
export function Checkbox({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        'border-input accent-primary size-4 shrink-0 rounded-xs border',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  )
}
