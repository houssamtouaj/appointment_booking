import { describe, expect, it } from 'vitest'

import {
  emptyServiceForm,
  isNoChange,
  serviceFormSchema,
  serviceFormValues,
  toCreateRequest,
  totalBlockPreview,
  toUpdatePatch,
  resolveServiceMessage,
  type ServiceFormValues,
} from '@/features/services/service-form'
import type { Service } from '@/types'

/**
 * The patch builder, and it is tested at unit level rather than through the
 * dialog because every failure it can have is **silent**.
 *
 * A patch that sends one field too few saves nothing and answers `200`. A patch
 * that sends `staffIds` wrong unassigns three colleagues and answers `200`. A
 * patch that sends `description: ""` for a field nobody touched wipes a
 * description and answers `200`. None of those produce an error to notice, and
 * none of them look different on the screen afterwards until somebody reloads.
 */

const SERVICE: Service = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Coupe classique',
  description: 'Wash, cut and finish.',
  durationMinutes: 60,
  priceCents: 3500,
  bufferBeforeMinutes: 5,
  bufferAfterMinutes: 10,
  totalBlockMinutes: 75,
  active: true,
  bookable: true,
  staffIds: ['33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444'],
}

const [AMELIE, MARC] = SERVICE.staffIds as [string, string]
const CAMILLE = '55555555-5555-5555-5555-555555555555'

function values(overrides: Partial<ServiceFormValues> = {}): ServiceFormValues {
  return { ...serviceFormValues(SERVICE, 'EUR'), ...overrides }
}

describe('serviceFormValues', () => {
  it('renders a price in currency units, not cents', () => {
    expect(serviceFormValues(SERVICE, 'EUR').price).toBe('35.00')
  })

  it('renders a zero buffer as blank, so nothing looks like a decision', () => {
    const noBuffers = { ...SERVICE, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 }
    const form = serviceFormValues(noBuffers, 'EUR')
    expect(form.bufferBeforeMinutes).toBe('')
    expect(form.bufferAfterMinutes).toBe('')
  })

  it('renders an absent description as blank rather than "undefined"', () => {
    const { description, ...withoutDescription } = SERVICE
    void description
    expect(serviceFormValues(withoutDescription as Service, 'EUR').description).toBe('')
  })
})

describe('toUpdatePatch', () => {
  it('sends nothing when nothing changed', () => {
    const patch = toUpdatePatch(values(), SERVICE, 'EUR')
    expect(patch).toEqual({})
    expect(isNoChange(patch)).toBe(true)
  })

  it('sends only the field that changed', () => {
    // The whole point: `ServiceUpdateRequest` leaves absent fields alone, so a
    // patch carrying every field is a patch that overwrites concurrent edits.
    expect(toUpdatePatch(values({ price: '12.10' }), SERVICE, 'EUR')).toEqual({
      priceCents: 1210,
    })
  })

  it('treats a blank buffer and a zero buffer as the same number', () => {
    // The form shows 0 as blank, so this is the round trip that must not read as
    // an edit — and the one `dirtyFields` would get wrong.
    const zeroed = { ...SERVICE, bufferBeforeMinutes: 0 }
    const form = { ...serviceFormValues(zeroed, 'EUR'), bufferBeforeMinutes: '0' }
    expect(toUpdatePatch(form, zeroed, 'EUR')).toEqual({})
  })

  it('does not count a value typed back to what it was', () => {
    // Dirty, and not a change. `dirtyFields` would send it.
    expect(toUpdatePatch(values({ name: 'Coupe classique' }), SERVICE, 'EUR')).toEqual({})
  })

  it('sends the whole staff set, never just the newly ticked one', () => {
    // The wave's sharpest watch-out: `staffIds` *replaces* the assignment set
    // server-side, so a patch of `[CAMILLE]` would unassign Amélie and Marc.
    const patch = toUpdatePatch(values({ staffIds: [AMELIE, MARC, CAMILLE] }), SERVICE, 'EUR')
    expect(patch.staffIds).toEqual([AMELIE, MARC, CAMILLE])
  })

  it('sends an empty array to unassign everybody, which is not the same as absent', () => {
    expect(toUpdatePatch(values({ staffIds: [] }), SERVICE, 'EUR')).toEqual({ staffIds: [] })
  })

  it('does not treat a reordering as an edit', () => {
    // `staffIds` comes back in join-table order, which is arbitrary. A patch here
    // would replace the set with itself for no reason.
    expect(toUpdatePatch(values({ staffIds: [MARC, AMELIE] }), SERVICE, 'EUR')).toEqual({})
  })

  it('clears a description with an empty string, and leaves an untouched blank alone', () => {
    expect(toUpdatePatch(values({ description: '' }), SERVICE, 'EUR')).toEqual({ description: '' })

    const { description, ...withoutDescription } = SERVICE
    void description
    const blank = withoutDescription as Service
    // RHF hands back `''` for the untouched optional field, and sending it would
    // be a write nobody asked for.
    expect(toUpdatePatch(serviceFormValues(blank, 'EUR'), blank, 'EUR')).toEqual({})
  })

  it('never puts a null in the patch, whatever is blank', () => {
    // `ServiceUpdateRequest` answers 422 for an explicit null, and JSON.stringify
    // keeps nulls while dropping undefined — so a null here would reach the API.
    const patch = toUpdatePatch(
      values({ description: '', bufferBeforeMinutes: '', bufferAfterMinutes: '' }),
      SERVICE,
      'EUR',
    )
    expect(JSON.stringify(patch)).not.toContain('null')
  })
})

describe('toCreateRequest', () => {
  it('omits a blank description rather than creating an empty one', () => {
    const request = toCreateRequest(
      { ...emptyServiceForm(), name: 'Brushing', durationMinutes: '30', price: '20' },
      'EUR',
    )
    expect('description' in request).toBe(false)
    expect(request).toEqual({
      name: 'Brushing',
      durationMinutes: 30,
      priceCents: 2000,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      staffIds: [],
    })
  })

  it('converts the price once, in cents, from the string that was typed', () => {
    const request = toCreateRequest(
      { ...emptyServiceForm(), name: 'Couleur', durationMinutes: '90', price: '12.10' },
      'EUR',
    )
    expect(request.priceCents).toBe(1210)
  })
})

describe('serviceFormSchema', () => {
  const base = { ...emptyServiceForm(), name: 'Brushing', durationMinutes: '30', price: '20' }

  it('accepts the shape the dialog produces', () => {
    expect(serviceFormSchema.safeParse(base).success).toBe(true)
  })

  it('rejects a duration that is not a multiple of five, with its own message', () => {
    // The backend validates the multiple separately for exactly this reason:
    // "between 5 and 480 and a multiple of 5" tells somebody who typed 47
    // nothing about which half they got wrong.
    const result = serviceFormSchema.safeParse({ ...base, durationMinutes: '47' })
    expect(result.success).toBe(false)
    // The message is a dictionary key from wave 10 — a module-scope schema
    // cannot hold a sentence without freezing the language it was imported in.
    // What matters here is unchanged: the multiple gets its *own* message rather
    // than being folded into the range one.
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      'services.form.durationStep',
    )
    expect(resolveServiceMessage('services.form.durationStep')).toBe('Use a multiple of 5 minutes')
  })

  it.each(['0', '4', '485', '', 'sixty', '30.5'])('rejects the duration %j', (duration) => {
    expect(serviceFormSchema.safeParse({ ...base, durationMinutes: duration }).success).toBe(false)
  })

  it('rejects a blank price rather than reading it as free', () => {
    expect(serviceFormSchema.safeParse({ ...base, price: '' }).success).toBe(false)
    expect(serviceFormSchema.safeParse({ ...base, price: '0' }).success).toBe(true)
  })

  it('accepts a blank buffer and rejects one over two hours', () => {
    expect(serviceFormSchema.safeParse({ ...base, bufferBeforeMinutes: '' }).success).toBe(true)
    expect(serviceFormSchema.safeParse({ ...base, bufferAfterMinutes: '121' }).success).toBe(false)
  })
})

describe('totalBlockPreview', () => {
  it('adds the buffers to the duration, matching totalBlockMinutes', () => {
    expect(
      totalBlockPreview({
        durationMinutes: '60',
        bufferBeforeMinutes: '5',
        bufferAfterMinutes: '10',
      }),
    ).toBe(SERVICE.totalBlockMinutes)
  })

  it('says nothing rather than NaN while the duration is being typed', () => {
    for (const duration of ['', '0', 'x']) {
      expect(
        totalBlockPreview({
          durationMinutes: duration,
          bufferBeforeMinutes: '5',
          bufferAfterMinutes: '',
        }),
      ).toBeUndefined()
    }
  })
})
