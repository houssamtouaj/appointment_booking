import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * `tailwind-merge`, taught the font sizes it cannot guess.
 *
 * It resolves conflicts by sorting each utility into a group, and it works out
 * the group from the class name alone — it never sees `theme.css`. For `text-*`
 * that means guessing between a font size and a text colour, and the guess is
 * "is the suffix a t-shirt size?". `text-2xs` passes. `text-display-md` does
 * not, so it is filed as a *colour*, and `cn('text-display-md text-foreground')`
 * returns **`text-foreground`** alone — the size silently deleted, the figure
 * rendered at the inherited 16px, and nothing anywhere reporting a problem.
 *
 * That is not hypothetical: it is what the dashboard's figures did, and it was
 * found by measuring the rendered font size rather than by reading the markup,
 * because the markup is correct. The classes only survive in `PageHeader` and
 * the other early screens because those pass a plain string and never reach
 * `twMerge` at all — which means the bug was waiting for the first component to
 * need a *conditional* display size, and would have kept waiting through waves 6
 * to 9.
 *
 * Declaring the scale here fixes it once for every caller. Anything added to the
 * `--text-*` block in `theme.css` whose suffix is not a t-shirt size has to be
 * added below in the same commit.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['display-sm', 'display-md', 'display-lg'] }],
    },
  },
})

/**
 * Merge Tailwind classes, last-wins on conflicts.
 *
 * The shadcn convention, kept because every atom pulled in by `shadcn add`
 * imports it by this name from this path.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
