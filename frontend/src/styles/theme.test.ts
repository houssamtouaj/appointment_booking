import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// Not `new URL(..., import.meta.url)`: under the jsdom environment Vitest rewrites
// import.meta.url to an http: URL, and readFileSync rejects it. Vitest resolves cwd
// to the Vite config's root, which is this directory.
const SRC = join(process.cwd(), 'src')
const THEME_CSS = readFileSync(join(SRC, 'styles/theme.css'), 'utf8')

/** The body of the block that starts at `selector`, comments stripped. */
function bodyAfter(css: string, selector: string): string {
  const start = css.indexOf(selector)
  if (start === -1) throw new Error(`theme.css no longer contains ${selector}`)

  const open = css.indexOf('{', start)
  let depth = 0
  let end = open
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }

  return css.slice(open + 1, end).replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Pull the custom-property declarations out of the block that starts at `selector`. */
function blockAfter(css: string, selector: string): Record<string, string> {
  const body = bodyAfter(css, selector)
  const declarations: Record<string, string> = {}
  for (const line of body.split(';')) {
    const match = /^\s*(--[\w-]+)\s*:\s*([\s\S]+)$/.exec(line)
    if (match?.[1] && match[2]) declarations[match[1]] = match[2].trim()
  }
  return declarations
}

describe('the two dark blocks', () => {
  // theme.css overrides the palette twice: once for an explicit [data-theme='dark']
  // and once for the OS preference. CSS gives no way to alias one to the other
  // without a third variable per token, so they are duplicated -- and duplication
  // drifts. This is the test that notices.
  const explicit = blockAfter(THEME_CSS, ":root[data-theme='dark']")
  const system = blockAfter(THEME_CSS, ":root:not([data-theme='light'])")

  it('override exactly the same tokens', () => {
    expect(Object.keys(system).sort()).toEqual(Object.keys(explicit).sort())
  })

  it('override them to the same values', () => {
    expect(system).toEqual(explicit)
  })

  it('cover every literal colour the light block defines', () => {
    const light = blockAfter(THEME_CSS, ':root')

    // Two exclusions, both deliberate. Aliases (`--foreground: var(--ink-900)`)
    // follow the palette on their own and must NOT be restated -- restating one
    // is how a token stops flipping. And non-colour literals (`--rule-height`)
    // do not vary by mode at all. What is left is the set that genuinely needs a
    // dark counterpart, and a new palette colour added to light without one is
    // the failure this catches.
    const colourLiterals = Object.entries(light)
      .filter(([, value]) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/.test(value))
      .map(([name]) => name)

    expect(colourLiterals.length).toBeGreaterThan(10)
    for (const token of colourLiterals) {
      expect(Object.keys(explicit)).toContain(token)
    }
  })
})

describe('the UA colour scheme', () => {
  // Scrollbars and native form controls are painted by the UA from this property,
  // not from the tokens above. Without it they follow prefers-color-scheme while
  // everything else follows data-theme, and the two disagree for as long as the
  // page is open. index.html's <meta> covers only the moment before this file
  // loads; these three declarations cover the rest.
  it.each([
    [':root', 'light'],
    [":root[data-theme='dark']", 'dark'],
    [":root:not([data-theme='light'])", 'dark'],
  ])('%s declares color-scheme: %s', (selector, expected) => {
    expect(bodyAfter(THEME_CSS, selector)).toMatch(new RegExp(`color-scheme:\\s*${expected}\\b`))
  })
})

const INDEX_CSS = readFileSync(join(SRC, 'index.css'), 'utf8')

describe('the one duration and the one easing', () => {
  it('are driven through the --default-* variables', () => {
    expect(INDEX_CSS).toContain('--default-transition-duration: var(--motion-duration)')
    expect(INDEX_CSS).toContain('--default-transition-timing-function: var(--motion-ease)')
  })

  it('are not driven through the --tw-* internals', () => {
    // The trap this replaced. Tailwind registers --tw-duration and --tw-ease with
    // `@property { inherits: false }`, so a value set on :root reaches no element
    // and every transition silently falls back to Tailwind's own 150ms -- taking
    // the prefers-reduced-motion override down with it, since that override works
    // by collapsing --motion-duration.
    expect(INDEX_CSS).not.toMatch(/--tw-(duration|ease)\s*:/)
  })

  it('collapse under prefers-reduced-motion', () => {
    expect(bodyAfter(THEME_CSS, '@media (prefers-reduced-motion: reduce)')).toMatch(
      /--motion-duration:\s*0\.01ms/,
    )
  })
})

/** Every .ts/.tsx under src/, so the scan below cannot be outrun by a new folder. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : []
  })
}

describe('the token discipline', () => {
  const files = sourceFiles(SRC).map((path) => [path, readFileSync(path, 'utf8')] as const)

  it('finds files to check', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  // Wave 1 gate: "every colour, radius and duration in the stub comes from a
  // token -- no literal hex or ms value in a component". Asserted rather than
  // promised, because this is the rule that erodes first and most quietly.
  it.each(files)('%s carries no literal colour', (path, source) => {
    const hex = source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
    const rgb = source.match(/\b(?:rgba?|hsla?|oklch)\(/g) ?? []

    expect(
      { hex, rgb },
      `${path} should read colours from a token in src/styles/theme.css`,
    ).toEqual({ hex: [], rgb: [] })
  })

  it.each(files)('%s carries no literal duration', (path, source) => {
    // A bare `160ms`, or Tailwind's arbitrary `duration-[120ms]`.
    const literal = source.match(/\b\d+(?:\.\d+)?ms\b|duration-\[[^\]]+\]/g) ?? []

    expect(literal, `${path} should use --motion-duration`).toEqual([])
  })
})
