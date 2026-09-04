import { describe, expect, it } from 'vitest'

import { assignableTo, bookabilityOf, performersOf } from '@/features/services/bookability'
import type { Lookups } from '@/hooks/use-lookups'
import type { Service, Staff } from '@/types'

/**
 * `catalog.test.tsx` asserts these sentences through the rendered row, which is
 * the behaviour-first style this project prefers and the reason this file is
 * short. What it covers is the one branch a row-level test cannot easily set up:
 * the guard at `unbookableReason`, which refuses to name anybody as departed
 * unless *every* assigned id resolved **and** every one of them is deactivated.
 *
 * That branch exists to stop a stale cache printing a sentence about a colleague
 * that is untrue — "Amélie is the only person assigned, and they have been
 * deactivated" when Amélie is at work — and its inputs are a half-answered
 * lookup, which is awkward to produce through a screen and trivial here.
 */

function staff(id: string, fullName: string, active = true): Staff {
  return { id, fullName, email: `${id}@slotflow.app`, role: 'STAFF', active } as Staff
}

function service(overrides: Partial<Service> = {}): Service {
  return {
    id: 'service-1',
    name: 'Cut and finish',
    durationMinutes: 45,
    priceCents: 4500,
    active: true,
    bookable: true,
    staffIds: [],
    ...overrides,
  } as Service
}

function lookups(people: Staff[]): Lookups {
  return {
    serviceById: new Map(),
    staffById: new Map(people.map((person) => [person.id, person])),
    isLoading: false,
    error: undefined,
  }
}

const AMELIE = staff('amelie', 'Amélie Rousseau')
const MARC = staff('marc', 'Marc Duval')
const DEPARTED = staff('amelie', 'Amélie Rousseau', false)
const ALSO_DEPARTED = staff('marc', 'Marc Duval', false)

describe('the three row states', () => {
  it('reads the verdict off the server and never recomputes it', () => {
    // `bookable: true` with nobody assigned is a contradiction the client does
    // not get to resolve — the server's answer stands, because recomputing it
    // here would put a copy of a domain rule in the client and be wrong the
    // moment the lookups are a minute stale.
    expect(bookabilityOf(service({ bookable: true, staffIds: [] }), lookups([])).state).toBe(
      'bookable',
    )
  })

  it('separates archived from unbookable, which are different problems', () => {
    // One is a decision. The other is a service the owner believes is selling.
    const archived = bookabilityOf(service({ active: false, bookable: false }), lookups([]))
    expect(archived.state).toBe('archived')
    // A dictionary key from wave 10, not a word: the chip translates it. This
    // asserts the label the table chose, which is the part this module owns.
    expect(archived.label).toBe('services.bookability.archived')
    // No reason: the row's Reactivate button is the whole story.
    expect(archived.reason).toBeUndefined()

    expect(bookabilityOf(service({ bookable: false }), lookups([])).state).toBe('unbookable')
  })
})

describe('naming the cause', () => {
  it('says nobody is assigned when nobody is', () => {
    const reason = bookabilityOf(service({ bookable: false, staffIds: [] }), lookups([])).reason

    expect(reason).toContain('Nobody is assigned')
  })

  it('names the one departed colleague when every id resolved and all are inactive', () => {
    const reason = bookabilityOf(
      service({ bookable: false, staffIds: ['amelie'] }),
      lookups([DEPARTED]),
    ).reason

    expect(reason).toBe(
      'Amélie Rousseau is the only person assigned to it, and they have been deactivated.',
    )
  })

  it('lists them all when there is more than one', () => {
    const reason = bookabilityOf(
      service({ bookable: false, staffIds: ['amelie', 'marc'] }),
      lookups([DEPARTED, ALSO_DEPARTED]),
    ).reason

    // `Intl.ListFormat`, not a `.join(', ')`: the conjunction belongs to the
    // language, and French writes "et" with no comma before it.
    expect(reason).toBe(
      'Everyone assigned to it has been deactivated: Amélie Rousseau and Marc Duval.',
    )
  })

  it('names nobody when an assigned id did not resolve', () => {
    // The lookups have not answered yet, or the catalogue names somebody outside
    // them. Either way this cannot say who left, and guessing would print a
    // sentence about a colleague who is at work.
    const reason = bookabilityOf(
      service({ bookable: false, staffIds: ['amelie', 'ghost'] }),
      lookups([DEPARTED]),
    ).reason

    expect(reason).toBe(
      'It offers no times on your booking page. Assign a colleague who is still active.',
    )
    expect(reason).not.toContain('Amélie')
  })

  it('names nobody when one assignee is still active', () => {
    // The server says not bookable and the client's view of the roster
    // disagrees. The stale one is the client's, so it says only what is certain.
    const reason = bookabilityOf(
      service({ bookable: false, staffIds: ['amelie', 'marc'] }),
      lookups([DEPARTED, MARC]),
    ).reason

    expect(reason).toBe(
      'It offers no times on your booking page. Assign a colleague who is still active.',
    )
    expect(reason).not.toContain('Marc')
  })
})

describe('the people on a row', () => {
  it('sorts by name, not by the join table order', () => {
    // Two services with the same two performers would otherwise disagree about
    // the order, which reads as a rendering bug.
    const performers = performersOf(
      service({ staffIds: ['marc', 'amelie'] }),
      lookups([MARC, AMELIE]),
    )

    expect(performers.map((person) => person.fullName)).toEqual(['Amélie Rousseau', 'Marc Duval'])
  })

  it('drops an id the lookups cannot resolve rather than drawing a stranger', () => {
    // A monogram built from "Unknown colleague" is a grey UN circle on the row,
    // which looks like a person who does not exist.
    const performers = performersOf(service({ staffIds: ['amelie', 'ghost'] }), lookups([AMELIE]))

    expect(performers).toHaveLength(1)
  })
})

describe('who can be offered', () => {
  it('excludes the deactivated and the already-assigned', () => {
    // Assigning a deactivated colleague leaves the row exactly as it is, having
    // taken an action — the worst possible answer to "why is this not bookable".
    const offered = assignableTo(
      service({ staffIds: ['amelie'] }),
      lookups([AMELIE, MARC, staff('sonia', 'Sonia Petit', false)]),
    )

    expect(offered.map((person) => person.id)).toEqual(['marc'])
  })
})
