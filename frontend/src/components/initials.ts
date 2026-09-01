/**
 * `"Amélie Rousseau"` → `"AR"`.
 *
 * Spread into code points rather than indexed with `[0]`, because `"Émile"[0]`
 * is fine and an emoji or a surrogate pair is not — a name field accepts
 * anything a person answers with, and half a code point renders as a
 * replacement character.
 *
 * In its own file for the reason `features/auth/auth-context.ts` gives: a module
 * that exports both a component and a function trips
 * `react-refresh/only-export-components`, and the cost of ignoring that is a
 * full reload instead of a fast refresh on every edit to the component. Being
 * importable is also what lets `monogram.test.tsx` name it directly — the
 * component is `aria-hidden` by design, so assertions about a name nobody
 * anticipated have no accessible DOM node to be made against.
 */
export function initialsOf(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => [...part][0] ?? '')
    .join('')
    .toUpperCase()
}
