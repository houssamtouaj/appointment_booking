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
 *
 * **The same guess is made for every other t-shirt scale**, so the rest of the
 * theme's role-named tokens are declared here too:
 *
 * - `shadow-e1|e2|e3` fails exactly the way `text-display-md` did — `e2` is not
 *   a t-shirt size, so it is filed as a shadow *colour* and
 *   `cn('shadow-e2 shadow-primary')` returns `shadow-primary` alone, dropping
 *   the elevation with nothing reporting it. Latent only because the two
 *   callers today pass plain strings, which is precisely the state the display
 *   sizes were in until a component needed a conditional one.
 * - `tracking-display|eyebrow` and `max-w-copy` fail the other way: no group at
 *   all, so `cn` keeps both sides of a conflict and the CSS source order
 *   decides rather than the last class, which is not what this function
 *   promises.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['display-sm', 'display-md', 'display-lg'] }],
      shadow: [{ shadow: ['e1', 'e2', 'e3'] }],
      tracking: [{ tracking: ['display', 'eyebrow'] }],
      'max-w': [{ 'max-w': ['copy'] }],
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
