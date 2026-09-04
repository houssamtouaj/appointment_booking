import { beforeEach, describe, expect, it } from 'vitest'
import type { ZodType } from 'zod'

import { loginRequestSchema, registerRequestSchema, passwordSchema } from '@/api/schemas/auth'
import { forgotPasswordRequestSchema, resetPasswordRequestSchema } from '@/api/schemas/auth'
import { bookingRequestSchema, guestDetailsSchema } from '@/api/schemas/booking'
import { acceptInvitationRequestSchema } from '@/api/schemas/invitation'
import { inviteStaffRequestSchema, updateStaffRequestSchema } from '@/api/schemas/staff'
import { translateIn, type TKey } from '@/i18n'
import { resetLanguageStoreForTests } from '@/i18n/language'

/**
 * The schemas in this folder are also React Hook Form resolvers, and a resolver
 * built at **module scope** is the one place a translated string cannot work: the
 * module is evaluated once, so a sentence in it is captured in whatever language
 * the tab was loaded in and survives a language switch unchanged. Wave 10 keyed
 * the two schemas that live under `features/`, and left every schema in
 * `api/schemas/` writing English — which a French customer read under "Votre nom"
 * on step 4 of the public booking flow.
 *
 * This is the guard that keeps them keys. `tsc` gets the first half through
 * `satisfies TKey`; what it cannot see is a `satisfies` that was never written,
 * so this drives real values through each schema and asserts that every message
 * Zod produces is a key the dictionary answers in **both** languages.
 */

/** A value guaranteed to fail every `.min`, `.email` and `.regex` on these schemas. */
const EMPTY = ''
/** Longer than the longest `.max` any of them declares (2000 on `notes`). */
const HUGE = 'x'.repeat(2100)

const CASES: ReadonlyArray<readonly [string, ZodType, unknown]> = [
  ['passwordSchema (short)', passwordSchema, EMPTY],
  // 72 *bytes*, so a three-byte character trips the refine at 25 characters.
  ['passwordSchema (long)', passwordSchema, 'é'.repeat(40)],

  ['loginRequestSchema', loginRequestSchema, { email: EMPTY, password: EMPTY }],
  [
    'registerRequestSchema',
    registerRequestSchema,
    {
      businessName: EMPTY,
      slug: EMPTY,
      timezone: 'Europe/Paris',
      currency: 'euro',
      fullName: EMPTY,
      email: EMPTY,
      password: EMPTY,
    },
  ],
  // A slug that is present but malformed, so the regex message is reached too.
  [
    'registerRequestSchema (slug shape)',
    registerRequestSchema,
    {
      businessName: 'A',
      slug: 'not a slug!',
      timezone: 'Europe/Paris',
      currency: 'EUR',
      fullName: 'A',
      email: 'a@b.co',
      password: 'password1',
    },
  ],
  ['forgotPasswordRequestSchema', forgotPasswordRequestSchema, { email: EMPTY }],
  ['resetPasswordRequestSchema', resetPasswordRequestSchema, { token: 'token', password: EMPTY }],
  [
    'acceptInvitationRequestSchema',
    acceptInvitationRequestSchema,
    { fullName: EMPTY, password: EMPTY },
  ],

  [
    'inviteStaffRequestSchema',
    inviteStaffRequestSchema,
    { email: EMPTY, fullName: EMPTY, role: 'STAFF' },
  ],
  ['updateStaffRequestSchema', updateStaffRequestSchema, { fullName: EMPTY }],

  [
    'guestDetailsSchema (empty)',
    guestDetailsSchema,
    { guestName: EMPTY, guestEmail: EMPTY, guestPhone: EMPTY, notes: EMPTY },
  ],
  [
    'guestDetailsSchema (too long)',
    guestDetailsSchema,
    { guestName: HUGE, guestEmail: HUGE, guestPhone: HUGE, notes: HUGE },
  ],
  [
    'bookingRequestSchema',
    bookingRequestSchema,
    {
      serviceId: '00000000-0000-4000-8000-000000000000',
      startsAt: '2026-03-02T09:00:00Z',
      guestName: EMPTY,
      guestEmail: 'not-an-address',
      notes: HUGE,
    },
  ],
]

function messagesFrom(schema: ZodType, value: unknown): string[] {
  const result = schema.safeParse(value)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

describe('every form-resolver schema carries keys rather than sentences', () => {
  beforeEach(() => {
    localStorage.clear()
    resetLanguageStoreForTests()
  })

  it.each(CASES)('%s', (_name, schema, value) => {
    const messages = messagesFrom(schema, value)

    // A case that stopped producing issues would pass every assertion below
    // forever, which is how the first version of the hardcoded-string scan came
    // to be checking nothing.
    expect(messages.length).toBeGreaterThan(0)

    for (const raw of messages) {
      // A dotted path with no spaces. A sentence fails this before it reaches
      // the dictionary, which is the more useful failure message of the two.
      expect(raw, `${raw} is not a dictionary key`).toMatch(/^[a-zA-Z]+(\.[a-zA-Z]+)+$/)

      const key = raw as TKey
      for (const language of ['en', 'fr'] as const) {
        const resolved = translateIn(language, key)
        // `translateIn` returns the key itself when it cannot find one, so a
        // resolved value equal to the key is a key that does not exist.
        expect(resolved, `${key} is missing from ${language}.ts`).not.toBe(key)
        expect(resolved.trim(), `${key} is empty in ${language}.ts`).not.toBe('')
      }
    }
  })

  it('says something different in French from what it says in English', () => {
    // The failure this prevents is the one the whole task is about: a message
    // that resolves in both languages but was copied unchanged into `fr.ts`.
    const messages = messagesFrom(guestDetailsSchema, {
      guestName: EMPTY,
      guestEmail: EMPTY,
      guestPhone: EMPTY,
      notes: EMPTY,
    })
    for (const raw of messages) {
      const key = raw as TKey
      expect(translateIn('fr', key), key).not.toBe(translateIn('en', key))
    }
  })
})
