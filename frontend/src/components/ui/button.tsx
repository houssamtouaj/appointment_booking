import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@/lib/utils'

/**
 * shadcn's button, with three deliberate departures from what the CLI ships.
 *
 * 1. `rounded-sm`, not `rounded-md`. Our radius scale gives a job to each step
 *    (theme.css §Radii) and a button is the 6px one; shadcn applies a single
 *    radius to everything it generates.
 * 2. No `outline-none` and no `ring-*`. The app has exactly one focus treatment,
 *    declared once on `:focus-visible` in index.css. shadcn's per-component ring
 *    would be a second one, and the two disagree on offset.
 * 3. Variants renamed to what they do here: `primary` takes a slot, `subtle` is
 *    the quiet sibling, `danger` cancels. Sizes keep a 44px `lg` because the
 *    booking flow's confirm button is a touch target on a phone.
 */
const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap',
    'rounded-sm text-sm font-medium transition-colors',
    'disabled:pointer-events-none disabled:opacity-50',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary-strong',
        outline: 'border border-input bg-card text-foreground hover:bg-accent',
        subtle: 'bg-secondary text-secondary-foreground hover:bg-border',
        ghost: 'text-foreground hover:bg-accent',
        danger: 'bg-destructive text-destructive-foreground hover:opacity-90',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4',
        // 44px: the minimum comfortable touch target, and the size the public
        // booking flow's primary action uses at 375px.
        lg: 'h-11 px-6 text-base',
        icon: 'size-9',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
