import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The translated surface, and nothing else.
 *
 * Deliberately a list rather than "everything under src/": Phase 2 adds the
 * admin features to it, and until then a scan over the whole tree would be a
 * hundred failures nobody is going to act on this week. Adding a folder here is
 * how Phase 2's tasks declare themselves finished.
 */
const TRANSLATED = [
  'src/components',
  'src/layouts',
  'src/pages',
  'src/features/auth',
  'src/features/booking',
]

/**
 * Props whose value is read by a person. `label`, `hint` and `title` are the
 * three this app uses most; `aria-label` is the one whose absence is invisible
 * until somebody uses a screen reader.
 */
const PROSE_PROPS = /(aria-label|placeholder|hint|title|eyebrow)="([^"]{4,})"/g

/**
 * A run of JSX text: at least two words, at least one lowercase letter, no
 * braces. Two words because a one-word run is usually a variable's neighbour
 * (`· `, `/`, `—`) and the false-positive rate at one word is not worth it.
 */
const JSX_TEXT = />\s*([A-Za-z][^<>{}]*\s+[^<>{}]*[a-z][^<>{}]*)\s*</g

/**
 * A match that is TypeScript rather than copy.
 *
 * `>` and `<` are not only JSX delimiters: `=>`, a comparison and a generic's
 * angle brackets all produce them, so the expression above happily spans from
 * the arrow of one callback to the `<` of a tag several statements later. Every
 * such match has something in it that prose in this app does not — an `=`, a
 * `;`, an optional-property `?:`, or a blank line between two statements.
 *
 * A discriminator rather than a longer allowlist, deliberately: an allowlist
 * grows one entry per false positive and each entry also blinds the scan to a
 * real string. This rules out a *shape*, and the shape is unambiguous.
 */
const LOOKS_LIKE_CODE = /[=;]|\?:|\n\s*\n/

/**
 * Strings that are not copy. Keep this list short and justified — a long
 * allowlist means the scan is wrong, not that the code is special.
 */
const ALLOWED = new Set([
  'Slotflow', // The wordmark. A brand name is the same in every language.
  '/b/', // A URL fragment shown as a URL.
])

/**
 * The same recursive walk `styles/theme.test.ts` uses, and deliberately not a
 * glob library: this repo has no glob dependency and adding one for a test file
 * is a runtime dependency's worth of supply chain for six lines of `readdirSync`.
 *
 * `process.cwd()` rather than `import.meta.url`, for the reason theme.test.ts
 * records: under the jsdom environment Vitest rewrites `import.meta.url` to an
 * `http:` URL and `readFileSync` rejects it.
 */
/**
 * Files inside the translated folders that are nevertheless not translated.
 *
 * One entry, and it has to earn its place the way an `ALLOWED` entry does.
 * `session-debug-panel.tsx` renders only under `import.meta.env.DEV`, which Vite
 * inlines as a literal `false` in a production build — the branch is constant
 * and the bundle keeps nothing that draws it. No customer can reach its words in
 * any language, so translating them would be two dictionary entries per string
 * for a surface that does not ship.
 */
const NOT_SHIPPED = new Set(['session-debug-panel.tsx'])

function componentsIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return componentsIn(full)
    if (NOT_SHIPPED.has(entry.name)) return []
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [full] : []
  })
}

const files = TRANSLATED.flatMap((dir) => componentsIn(join(process.cwd(), dir))).map(
  (path) => [path, readFileSync(path, 'utf8')] as const,
)

describe('the translated surface', () => {
  it('finds files to check', () => {
    // The failure this prevents: a file list that matches nothing passes every
    // case below forever. theme.test.ts carries the same assertion for the same
    // reason.
    expect(files.length).toBeGreaterThan(40)
  })

  it.each(files)('%s has no literal prose prop', (_path, source) => {
    const found = [...source.matchAll(PROSE_PROPS)]
      .map((match) => match[2] ?? '')
      .filter((value) => !ALLOWED.has(value) && /\s/.test(value))
    expect(found).toEqual([])
  })

  it.each(files)('%s has no literal JSX sentence', (_path, source) => {
    const found = [...stripComments(source).matchAll(JSX_TEXT)]
      .map((match) => (match[1] ?? '').trim())
      .filter((value) => !ALLOWED.has(value) && !LOOKS_LIKE_CODE.test(value))
    expect(found).toEqual([])
  })
})

/**
 * Comments are prose and are meant to be. This file's whole value depends on not
 * flagging them — every component in this codebase carries a long one.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}
