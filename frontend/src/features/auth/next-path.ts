/**
 * Where to go after signing in, from `?next=`.
 *
 * The check is not decoration. `?next=` is a value an attacker chooses and a
 * person clicks, and a login screen that redirects to whatever it is handed is
 * the classic open redirect: a link to *our* domain that lands on theirs, with
 * our sign-in flow lending it the credibility. Three shapes have to be refused,
 * and the second is the one that gets missed:
 *
 * - `https://evil.example/x` — an absolute URL. Obvious.
 * - `//evil.example/x` — protocol-relative. It starts with `/`, so a naive
 *   `startsWith('/')` guard admits it, and the browser reads it as an absolute
 *   URL to another host. `/\evil.example` is the same trick with a backslash,
 *   which some browsers normalise to a forward slash.
 * - Anything containing a control character, which can truncate the value in one
 *   parser and not in the next.
 */
export const DEFAULT_AFTER_SIGN_IN = '/dashboard'

export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_AFTER_SIGN_IN

  const value = raw.trim()
  if (!value.startsWith('/')) return DEFAULT_AFTER_SIGN_IN
  if (value.startsWith('//') || value.startsWith('/\\')) return DEFAULT_AFTER_SIGN_IN
  if (hasControlCharacter(value)) return DEFAULT_AFTER_SIGN_IN

  return value
}

/** C0 controls and DEL, tested by code point rather than by a regex full of escapes. */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}
