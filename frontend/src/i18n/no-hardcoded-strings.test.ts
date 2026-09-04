import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The whole of `src/`, which is where wave 10 was aiming.
 *
 * Phase 1 shipped this as a per-folder list because the admin features were
 * still English and a total scan would have been a hundred failures nobody was
 * going to act on that week. Phase 2 finished them, so the list is gone: there
 * is no folder left that gets to opt out, and adding one would now be a decision
 * somebody has to argue for rather than a line nobody notices.
 *
 * Phase 3 closed the other half of the same hole. "Total" was true about folders
 * and false about **file types** — `componentsIn` matched `/\.tsx$/`, so not one
 * `.ts` file was read, and the review that found it proved the point by adding
 * `export const LEAK = 'This colleague has left the business'` to
 * `hooks/use-lookups.ts` and watching the suite stay green. Every module-scope
 * constant, every Zod message and every plain function that writes a sentence
 * lives in a `.ts` file, and those are the strings that *most* need catching:
 * a sentence built at module scope freezes the language the tab was loaded in
 * and survives a switch.
 */
const TRANSLATED = ['src']

/**
 * Props whose value is read by a person. `label`, `hint` and `title` are the
 * three this app uses most; `aria-label` is the one whose absence is invisible
 * until somebody uses a screen reader.
 */
const PROSE_PROPS = /(aria-label|placeholder|hint|title|eyebrow)="([^"]{4,})"/g

/**
 * The same props, given a **template literal** instead of a string.
 *
 * A gap the first version of this scan had, and a real string got through it:
 * `calendar-page.tsx` passed `` description={`Every appointment at ${name}, in
 * ${city} time.`} ``, which is neither a quoted prop nor JSX text. A template
 * with prose in it is exactly the shape a sentence takes when somebody needs to
 * interpolate a value, which is the shape most likely to need a key.
 *
 * `description` and `label` join the list here where they cannot above: as
 * quoted props they are given a variable often enough to be noise, but a
 * *template* with two words of prose in it is copy every time.
 */
const PROSE_TEMPLATES =
  /(aria-label|placeholder|hint|title|eyebrow|description|label)=\{`([^`]*[A-Za-z]{2,}\s+[A-Za-z]{2,}[^`]*)`\}/g

/**
 * A run of JSX text: at least two words, at least one lowercase letter, no
 * braces. Two words because a one-word run is usually a variable's neighbour
 * (`· `, `/`, `—`) and the false-positive rate at one word is not worth it.
 *
 * **It ends at `<` or at `{`**, and the second terminator is phase 3's. A run
 * that ends at an expression rather than at a tag is the commonest shape a
 * half-translated line takes — `` >Performed by {names}< ``, `` >Go to
 * {formatDayHeading(day)}< ``, and the three places wave 10 left English in
 * front of a `{' '}` spacer. All four read as finished JSX and all four were
 * invisible while the run had to reach a closing tag.
 */
const JSX_TEXT = />\s*([A-Za-z][^<>{}]*\s+[^<>{}]*[a-z][^<>{}]*?)\s*[<{]/g

/**
 * A single capitalised word that is an element's whole content.
 *
 * The two-word rule above is right for a *run* of text — a one-word run is
 * usually a variable's neighbour, a `·` or a `/`. But a lone capitalised word
 * between an opening and a closing tag is a button, and this is how "Edit",
 * "Deactivate" and "Reactivate" survived every pass of wave 10 until somebody
 * looked at the team page in French.
 *
 * Three letters minimum, and a trailing colon allowed for a label like
 * "Performs:". The wordmark is in `ALLOWED`.
 */
const LONE_WORD = />\s*([A-Z][a-zA-Z]{2,}:?)\s*</g

/**
 * A match that is TypeScript rather than copy.
 *
 * `>` and `<` are not only JSX delimiters: `=>`, a comparison and a generic's
 * angle brackets all produce them, so the expression above happily spans from
 * the arrow of one callback to the `<` of a tag several statements later. Every
 * such match has something in it that prose in this app does not — an `=`, a
 * `;`, an optional-property `?:`, a typed callback's `: (`, a call's `name(`, a
 * `||` or `&&`, or a blank line between two statements.
 *
 * A discriminator rather than a longer allowlist, deliberately: an allowlist
 * grows one entry per false positive and each entry also blinds the scan to a
 * real string. This rules out a *shape*, and the shape is unambiguous.
 *
 * Note what is deliberately *not* here: a bare `(`. Prose has parentheses —
 * "Phone (optional)" is a real label — and banning them would turn this into an
 * allowlist by another name. `\w\(` is safe where `\(` is not, because prose puts
 * a space before an opening bracket and a call never does.
 */
const LOOKS_LIKE_CODE = /[=;]|\?:|:\s*\(|\w\(|\|\||&&|\n\s*\n/

/**
 * Every string and template literal in a file, whatever it is doing there.
 *
 * This is the rule that makes scanning `.ts` worth anything. A `.ts` file has no
 * JSX, so the four expressions above find nothing in one; what it has instead is
 * a `const` holding a sentence, a Zod `.min(1, 'Enter your name')`, a toast body
 * assembled in a mutation callback. Those are strings and nothing else, and the
 * review proved the gap the same way it proved the first one — dropping
 * `` `Booked by ${n} people this week` `` into a component left the suite green.
 */
const STRINGS = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g

/**
 * English function words: articles, copulas and auxiliaries, prepositions,
 * conjunctions, pronouns.
 *
 * The discriminator for {@link STRINGS}, and modelled on {@link LOOKS_LIKE_CODE}
 * rather than on an allowlist for the reason that comment gives. A string with
 * two or more words in it is a class list far more often than it is a sentence —
 * `'flex items-center justify-between gap-3'` outnumbers copy in this codebase by
 * an order of magnitude. What separates them is not length: it is that English
 * prose cannot go two words without one of *these*, and a utility class list
 * never contains one as a whole token. `justify-between` is why the match is
 * per-token and not `\b`-anchored — a word boundary finds "between" inside it and
 * flags every flex row in the app.
 */
const FUNCTION_WORD =
  /^(?:an|the|is|are|was|were|be|been|am|to|of|in|on|at|for|from|with|by|and|or|but|nor|that|this|these|those|it|its|your|you|we|our|us|as|not|no|has|have|had|will|would|can|could|do|does|did|if|when|while|there|their|they|them|about|into|over|under|up|down|out|off|than|then|so|too|only|any|all|every|each|some|what|which|who|whom|how|why|because|per|via|yet|still|already|just|now|before|after|between|during|until|since|again|else|both|must|may|should|shall|being)$/i

/**
 * A word that opens a sentence.
 *
 * The second half of the discriminator, for the copy that is two words and no
 * function word: "Unknown service", "Signed out", "Link expired". Tailwind has no
 * capitals and a date-fns pattern capitalises whole tokens (`EEEE`, `MMMM`), so
 * `[A-Z]` followed by lower case is a shape neither of them has.
 */
const SENTENCE_WORD = /^[A-Z][a-z]+$/

/**
 * Calls whose string arguments are diagnostics rather than copy.
 *
 * Shape-based, so that no file has to be named: what these three have in common
 * is that a person only ever reads them through devtools or a stack trace.
 * `console.error` in `api/reference.ts` says the reference cache has outgrown one
 * page; `new Error` / `new RangeError` and the `super(...)` of an `Error`
 * subclass carry a message meant for whoever is debugging. Translating any of
 * them would put two dictionary entries behind a string no customer can reach.
 */
const DIAGNOSTIC_CALL = /\b(?:console\.\w+|new\s+\w*Error|super)\s*\(/g

/**
 * Strings that are not copy. Keep this list short and justified — a long
 * allowlist means the scan is wrong, not that the code is special.
 */
const ALLOWED = new Set([
  'Slotflow', // The wordmark. A brand name is the same in every language.
  '/b/', // A URL fragment shown as a URL.
  // `currencyCode`'s Zod message in `api/schemas/common.ts`. It is a
  // *response*-parsing schema — the message fires when the API breaks the
  // contract, never under a form field — so it belongs with the diagnostics
  // above and cannot be reached by shape, because a Zod message is written the
  // same way whether or not a resolver renders it.
  'must be a three-letter ISO 4217 code',
])

/**
 * Files inside the translated folders that are nevertheless not translated.
 *
 * It has to earn its place the way an `ALLOWED` entry does.
 * `session-debug-panel.tsx` renders only under `import.meta.env.DEV`, which Vite
 * inlines as a literal `false` in a production build — the branch is constant
 * and the bundle keeps nothing that draws it. No customer can reach its words in
 * any language, so translating them would be two dictionary entries per string
 * for a surface that does not ship.
 *
 * `en.ts` and `fr.ts` are the other kind of exception, and the only one: they are
 * what every other file is being made to point at. A scan that flagged the
 * dictionary would be asking the answer to translate itself.
 */
const NOT_SHIPPED = new Set(['session-debug-panel.tsx', 'en.ts', 'fr.ts'])

/**
 * The same recursive walk `styles/theme.test.ts` uses, and deliberately not a
 * glob library: this repo has no glob dependency and adding one for a test file
 * is a runtime dependency's worth of supply chain for six lines of `readdirSync`.
 *
 * `process.cwd()` rather than `import.meta.url`, for the reason theme.test.ts
 * records: under the jsdom environment Vitest rewrites `import.meta.url` to an
 * `http:` URL and `readFileSync` rejects it.
 */
function sourcesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourcesIn(full)
    if (NOT_SHIPPED.has(entry.name)) return []
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : []
  })
}

const sources = TRANSLATED.flatMap((dir) => sourcesIn(join(process.cwd(), dir))).map(
  (path) => [path, readFileSync(path, 'utf8')] as const,
)

/**
 * The four JSX-shaped rules run on `.tsx` only, and that is not an opt-out: TypeScript
 * refuses JSX syntax in a `.ts` file, so there is nothing for them to find. Running
 * them anyway is not free either — `>` and `{` in a `.ts` file are generics and object
 * literals, and `import type { A } from 'a'\nimport` matches a JSX text run perfectly.
 */
const components = sources.filter(([path]) => path.endsWith('.tsx'))

describe('the translated surface', () => {
  it('finds files to check', () => {
    // The failure this prevents: a file list that matches nothing passes every
    // case below forever. theme.test.ts carries the same assertion for the same
    // reason. Both floors are near the real counts — 182 sources, 99 of them
    // components — because the loose floor this had before survived `.ts` never
    // being read at all.
    expect(sources.length).toBeGreaterThan(150)
    expect(components.length).toBeGreaterThan(90)
  })

  it.each(components)('%s has no literal prose prop', (_path, source) => {
    const found = [...source.matchAll(PROSE_PROPS)]
      .map((match) => match[2] ?? '')
      .filter((value) => !ALLOWED.has(value) && /\s/.test(value))
    expect(found).toEqual([])
  })

  it.each(components)('%s has no prose in a template-literal prop', (_path, source) => {
    const found = [...stripComments(source).matchAll(PROSE_TEMPLATES)]
      .map((match) => (match[2] ?? '').trim())
      .filter((value) => !ALLOWED.has(value))
    expect(found).toEqual([])
  })

  it.each(components)(
    '%s has no lone capitalised word as an element’s content',
    (_path, source) => {
      const found = [...stripComments(source).matchAll(LONE_WORD)]
        .map((match) => (match[1] ?? '').trim())
        .filter((value) => !ALLOWED.has(value))
      expect(found).toEqual([])
    },
  )

  it.each(components)('%s has no literal JSX sentence', (_path, source) => {
    const found = [...stripComments(source).matchAll(JSX_TEXT)]
      .map((match) => (match[1] ?? '').trim())
      .filter((value) => !ALLOWED.has(value) && !LOOKS_LIKE_CODE.test(value))
    expect(found).toEqual([])
  })

  it.each(sources)('%s has no prose in a string literal', (_path, source) => {
    const scanned = maskDiagnostics(stripComments(source))
    const found = [...scanned.matchAll(STRINGS)]
      .map((match) => match[1] ?? match[2] ?? match[3] ?? '')
      .filter((value) => !ALLOWED.has(value) && isProse(value))
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

/**
 * Blank out the argument list of every {@link DIAGNOSTIC_CALL}, counting brackets
 * so that a call spanning four lines with a nested `JSON.stringify(...)` in it
 * ends where it actually ends. Newlines survive, so a reported line number still
 * points at the right line.
 */
function maskDiagnostics(source: string): string {
  const out = [...source]
  for (const match of source.matchAll(DIAGNOSTIC_CALL)) {
    let depth = 1
    let index = match.index + match[0].length
    while (index < source.length && depth > 0) {
      const char = source[index]
      if (char === '(') depth += 1
      else if (char === ')') depth -= 1
      if (depth > 0 && char !== '\n') out[index] = ' '
      index += 1
    }
  }
  return out.join('')
}

/**
 * The words of a string, once every `${...}` is gone.
 *
 * Dropping the interpolations rather than keeping them is what stops `` `Bearer
 * ${token}` `` and `` `/api/staff/${id}/exceptions` `` counting as two words. The
 * cost is that it also hides the shortest copy — `` `blocks ${n} min` `` is one
 * word to this function — and that is the scan's remaining blind spot, recorded
 * here rather than papered over: a template whose only prose is a single word
 * beside a value cannot be told from an id being built.
 */
function words(value: string): string[] {
  return value
    .replace(/\$\{[^}]*\}/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z]+$/, ''))
    .filter((token) => /^[A-Za-z]{2,}$/.test(token))
}

function isProse(value: string): boolean {
  const found = words(value)
  return (
    found.length >= 2 && found.some((word) => FUNCTION_WORD.test(word) || SENTENCE_WORD.test(word))
  )
}
