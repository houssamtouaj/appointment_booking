#!/usr/bin/env node
/**
 * Diffs the hand-written Zod schemas against the API's live OpenAPI document
 * (F3, F4).
 *
 * Wave 2 chose to hand-write the contract rather than generate a client, and
 * `src/api/schemas/common.ts` records the concrete reason: springdoc types
 * `Currency` as `object` while the wire format is the string `"EUR"`, so the
 * generated client would be wrong in a way that fails at runtime. The honest
 * cost of hand-writing is drift — a field renamed on the server and nowhere
 * else — and this script is the payment.
 *
 * **Local only, and deliberately not in `web.yml`.** It needs a running API, and
 * a required check that depends on a service being up is a check that goes red
 * for reasons unrelated to the commit. Run it before merging a wave:
 *
 *     docker compose up          # from the repository root
 *     npm run contract:check
 *
 * It compares property *names*, not types. Types are what the OpenAPI document
 * gets wrong (see above); names are what it gets right, and a rename is the
 * drift that actually breaks a screen.
 */
import process from 'node:process'

import { createServer, loadEnv } from 'vite'

const DOC_PATH = '/v3/api-docs'
const REGISTRY_MODULE = '/src/api/schemas/registry.ts'

// Built from a char code rather than written as a literal ESC byte: a source
// file carrying raw control characters survives exactly one careless editor.
const ESC = String.fromCharCode(27) + '['
const colours = {
  reset: `${ESC}0m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  dim: `${ESC}2m`,
}

async function main() {
  const env = loadEnv('development', process.cwd(), '')
  const baseUrl = (
    process.env.VITE_API_BASE_URL ||
    env.VITE_API_BASE_URL ||
    'http://localhost:8081'
  ).replace(/\/+$/, '')

  const document = await fetchDocument(`${baseUrl}${DOC_PATH}`)
  const published = document.components?.schemas ?? {}
  const declared = await loadRegistry()

  let failures = 0

  for (const [name, schema] of Object.entries(declared)) {
    const publishedSchema = published[name]
    if (!publishedSchema) {
      failures += 1
      console.error(
        `${colours.red}✗ ${name}${colours.reset} is in the registry but not in ${DOC_PATH}.`,
      )
      console.error(
        `  ${colours.dim}Either the endpoint was removed, or the API is running a profile that does not expose it.${colours.reset}`,
      )
      continue
    }

    const ours = Object.keys(schema.shape).sort()
    const theirs = Object.keys(propertiesOf(publishedSchema, published)).sort()

    const missing = theirs.filter((field) => !ours.includes(field))
    const extra = ours.filter((field) => !theirs.includes(field))
    const { renamed, added, removed } = pairRenames(missing, extra)

    if (renamed.length === 0 && added.length === 0 && removed.length === 0) {
      console.log(
        `${colours.green}✓ ${name}${colours.reset} ${colours.dim}${ours.length} fields${colours.reset}`,
      )
      continue
    }

    failures += 1
    console.error(`${colours.red}✗ ${name}${colours.reset}`)
    for (const [from, to] of renamed) {
      console.error(`  ${colours.yellow}renamed${colours.reset}  ${from} → ${to}`)
    }
    for (const field of added) {
      console.error(
        `  ${colours.yellow}added${colours.reset}    ${field}  ${colours.dim}(the API sends it; the schema does not declare it)${colours.reset}`,
      )
    }
    for (const field of removed) {
      console.error(
        `  ${colours.yellow}removed${colours.reset}  ${field}  ${colours.dim}(the schema declares it; the API does not send it)${colours.reset}`,
      )
    }
  }

  const checked = Object.keys(declared).length
  if (failures > 0) {
    console.error(
      `\n${colours.red}${failures} of ${checked} schemas drifted.${colours.reset} Update src/api/schemas/, then re-run.`,
    )
    process.exit(1)
  }
  console.log(`\n${colours.green}${checked} schemas match ${baseUrl}${DOC_PATH}.${colours.reset}`)
}

async function fetchDocument(url) {
  let response
  try {
    response = await fetch(url)
  } catch (error) {
    console.error(`${colours.red}Could not reach ${url}${colours.reset}`)
    console.error(
      `  ${colours.dim}This script needs a running API. From the repository root: docker compose up${colours.reset}`,
    )
    console.error(`  ${colours.dim}${error.message}${colours.reset}`)
    process.exit(1)
  }
  if (!response.ok) {
    console.error(`${colours.red}${url} answered ${response.status}${colours.reset}`)
    process.exit(1)
  }
  return response.json()
}

/**
 * Loads the registry through Vite's own SSR pipeline.
 *
 * The registry is TypeScript and imports through the `@/` alias, so Node cannot
 * read it directly. Vite can, it is already a dependency, and it resolves the
 * alias from `vite.config.ts` — which means the script and the app cannot
 * disagree about what `@/api/schemas` points at.
 */
async function loadRegistry() {
  const server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    // The dev server prints its own banner and watches the filesystem; neither
    // is wanted for a one-shot script.
    logLevel: 'warn',
  })
  try {
    const module = await server.ssrLoadModule(REGISTRY_MODULE)
    return module.CONTRACT_SCHEMAS
  } finally {
    await server.close()
  }
}

/**
 * The property names of an OpenAPI schema, following one level of `allOf` — the
 * shape springdoc emits for a record that extends or composes another. Anything
 * deeper is not in this API and would be guessing.
 */
function propertiesOf(schema, all) {
  if (schema.properties) return schema.properties

  if (Array.isArray(schema.allOf)) {
    return schema.allOf.reduce((accumulated, part) => {
      const resolved = part.$ref ? all[refName(part.$ref)] : part
      return { ...accumulated, ...(resolved?.properties ?? {}) }
    }, {})
  }

  return {}
}

function refName(ref) {
  return ref.split('/').pop()
}

/**
 * A field that vanished and a field that appeared are usually one rename, and
 * saying so is the difference between a report someone acts on and a list they
 * skim. The pairing is by normalised name — case and separators removed — which
 * catches `noShowRate` → `no_show_rate` and honestly cannot catch a rename to
 * something genuinely different. Those stay reported as one added and one
 * removed, which is also the truth.
 */
function pairRenames(missing, extra) {
  const renamed = []
  const added = [...missing]
  const removed = [...extra]

  for (const candidate of [...added]) {
    const match = removed.find((field) => normalise(field) === normalise(candidate))
    if (!match) continue
    renamed.push([match, candidate])
    added.splice(added.indexOf(candidate), 1)
    removed.splice(removed.indexOf(match), 1)
  }

  return { renamed, added, removed }
}

function normalise(field) {
  return field.toLowerCase().replace(/[^a-z0-9]/g, '')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
