import { z } from 'zod'

import { uuid } from '@/api/schemas/common'
import {
  MAX_BUFFER_MINUTES,
  SERVICE_MAX_MINUTES,
  SERVICE_MIN_MINUTES,
  SERVICE_STEP_MINUTES,
} from '@/api/schemas/catalog'
import { isAmountInput, toAmountInput, toMinorUnits } from '@/lib/money'
import type { Service, ServiceRequest, ServiceUpdateRequest } from '@/types'

/**
 * The service dialog's own shape, and the two conversions in and out of it.
 *
 * **Every field is a string, including the numbers.** That is not laziness about
 * `valueAsNumber`; it is the whole reason `lib/money.ts` exists. A price typed as
 * `12.10` must reach the API as the integer `1210`, and the only way to guarantee
 * that is for no `double` ever to be made out of it — so the field holds the
 * characters the person typed and {@link toMinorUnits} does string arithmetic on
 * them. Once the price is a string the minutes may as well be too, because the
 * alternative is an `NaN` from an empty number input reported as "expected
 * number, received nan" rather than as "enter how long it takes".
 *
 * The other reason is the one the wave's watch-outs name: React Hook Form hands
 * back empty strings for untouched optional fields, and `ServiceUpdateRequest` is
 * a patch where absent means *leave it alone* and `null` is a 422. Keeping the
 * form's shape visibly different from the request's shape means there is a
 * function between them — {@link toUpdatePatch} — with somewhere to put that rule.
 */

export type ServiceFormValues = {
  name: string
  description: string
  durationMinutes: string
  /** Currency **units**, as typed: `"12.10"`. Never minor units, never a number. */
  price: string
  bufferBeforeMinutes: string
  bufferAfterMinutes: string
  staffIds: string[]
}

const wholeMinutes = /^\d+$/

/**
 * Client-side validation, mirroring the backend's constraints so a person is
 * told before the round trip rather than after it. The server checks all of it
 * again and its 422 still lands on the field through `applyFieldErrors` — rule 1
 * holds, and this is a courtesy rather than the correctness.
 */
export const serviceFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give the service a name')
    // `@Size(min = 2)` on the server. Split from the blank check because "at
    // least two characters" is a strange thing to say to somebody who typed
    // nothing at all.
    .min(2, 'Use at least two characters')
    .max(120, 'Keep it under 120 characters'),

  description: z.string().trim().max(2000, 'Keep it under 2000 characters'),

  durationMinutes: z
    .string()
    .trim()
    .min(1, 'Enter how long the appointment takes')
    .regex(wholeMinutes, 'Enter a whole number of minutes')
    .refine(
      (value) => Number(value) >= SERVICE_MIN_MINUTES && Number(value) <= SERVICE_MAX_MINUTES,
      `Between ${SERVICE_MIN_MINUTES} and ${SERVICE_MAX_MINUTES} minutes`,
    )
    // The server's third message, and the one people actually hit: it validates
    // the multiple separately precisely because "must be between 5 and 480 and a
    // multiple of 5" tells somebody who typed 47 nothing about which half they
    // got wrong.
    .refine(
      (value) => Number(value) % SERVICE_STEP_MINUTES === 0,
      `Use a multiple of ${SERVICE_STEP_MINUTES} minutes`,
    ),

  price: z
    .string()
    .trim()
    .min(1, 'Enter a price')
    // `isAmountInput` and not `Number.isFinite(Number(text))`: `Number('')` is 0,
    // so the lax check turns a blank price field into a free service.
    .refine(isAmountInput, 'Enter a price like 12.50'),

  bufferBeforeMinutes: bufferField(),
  bufferAfterMinutes: bufferField(),

  staffIds: z.array(uuid),
})

/**
 * A buffer, or blank. Blank is 0 and is the common answer, so it must not be an
 * error — but a blank that reached the API as `null` would be a 422, which is why
 * {@link minutesOf} turns it into a number here rather than leaving it out.
 */
function bufferField() {
  return z
    .string()
    .trim()
    .refine(
      (value) => value === '' || wholeMinutes.test(value),
      'Enter a whole number of minutes, or leave it blank for none',
    )
    .refine(
      (value) => value === '' || Number(value) <= MAX_BUFFER_MINUTES,
      `At most ${MAX_BUFFER_MINUTES} minutes`,
    )
}

/** Blank is zero. Anything the schema rejected never gets here. */
function minutesOf(value: string): number {
  const trimmed = value.trim()
  return trimmed === '' ? 0 : Number(trimmed)
}

/** A new service: empty, with both buffers blank and nobody assigned yet. */
export function emptyServiceForm(): ServiceFormValues {
  return {
    name: '',
    description: '',
    durationMinutes: '',
    price: '',
    bufferBeforeMinutes: '',
    bufferAfterMinutes: '',
    staffIds: [],
  }
}

/**
 * An existing service, as the form holds it.
 *
 * Buffers of zero are rendered **blank** rather than as `"0"`. Zero is the
 * default and the overwhelmingly common answer, and a field pre-filled with `0`
 * invites somebody to think a decision has been made about it. Blank and `0`
 * round-trip identically — {@link minutesOf} maps both to 0 and
 * {@link toUpdatePatch} then sees no change.
 */
export function serviceFormValues(service: Service, currency: string): ServiceFormValues {
  return {
    name: service.name,
    description: service.description ?? '',
    durationMinutes: String(service.durationMinutes),
    price: toAmountInput(service.priceCents, currency),
    bufferBeforeMinutes:
      service.bufferBeforeMinutes === 0 ? '' : String(service.bufferBeforeMinutes),
    bufferAfterMinutes: service.bufferAfterMinutes === 0 ? '' : String(service.bufferAfterMinutes),
    staffIds: service.staffIds,
  }
}

/**
 * The create body. Everything is sent, because on a create there is nothing to
 * leave alone.
 *
 * `description` is the one exception: blank is **omitted** rather than sent as
 * `""`, so a service with no description comes back with the field absent — which
 * is the shape `serviceSchema` describes and the shape every other endpoint
 * produces. Sending `""` would create a service whose description is an empty
 * string, which is a different thing from a service without one and prints an
 * empty paragraph on the public page.
 */
export function toCreateRequest(values: ServiceFormValues, currency: string): ServiceRequest {
  const description = values.description.trim()

  return {
    name: values.name.trim(),
    ...(description === '' ? {} : { description }),
    durationMinutes: Number(values.durationMinutes.trim()),
    priceCents: toMinorUnits(values.price, currency),
    bufferBeforeMinutes: minutesOf(values.bufferBeforeMinutes),
    bufferAfterMinutes: minutesOf(values.bufferAfterMinutes),
    staffIds: values.staffIds,
  }
}

/**
 * The patch: **only what changed**, and nothing else.
 *
 * Diffed against the service the dialog was opened on rather than against React
 * Hook Form's `dirtyFields`, and the difference matters twice. A person who types
 * a `7`, deletes it and types the original value back has a dirty field and no
 * change; and `dirtyFields` says nothing about the buffer whose blank and whose
 * `0` are the same number. Comparing values is the only version of this that is
 * right in both cases.
 *
 * `staffIds` is compared as a **set** and sent whole. Order is the order rows
 * came out of the join table and means nothing, so a reordering must not count
 * as an edit; and the field replaces the entire assignment set server-side, so a
 * patch carrying only the newly ticked boxes would unassign everybody already
 * there. That is the wave's sharpest watch-out and it is one line either way.
 */
export function toUpdatePatch(
  values: ServiceFormValues,
  service: Service,
  currency: string,
): ServiceUpdateRequest {
  const patch: ServiceUpdateRequest = {}

  const name = values.name.trim()
  if (name !== service.name) patch.name = name

  const description = values.description.trim()
  // `service.description ?? ''` is what makes "absent" and "blank" the same
  // starting point. Clearing a description therefore sends `""` — which the
  // backend stores as an empty string, because there is no way through this API
  // to put a `null` back. Worth knowing and not worth a second endpoint.
  if (description !== (service.description ?? '')) patch.description = description

  const durationMinutes = Number(values.durationMinutes.trim())
  if (durationMinutes !== service.durationMinutes) patch.durationMinutes = durationMinutes

  const priceCents = toMinorUnits(values.price, currency)
  if (priceCents !== service.priceCents) patch.priceCents = priceCents

  const bufferBeforeMinutes = minutesOf(values.bufferBeforeMinutes)
  if (bufferBeforeMinutes !== service.bufferBeforeMinutes) {
    patch.bufferBeforeMinutes = bufferBeforeMinutes
  }

  const bufferAfterMinutes = minutesOf(values.bufferAfterMinutes)
  if (bufferAfterMinutes !== service.bufferAfterMinutes) {
    patch.bufferAfterMinutes = bufferAfterMinutes
  }

  if (!sameMembers(values.staffIds, service.staffIds)) patch.staffIds = values.staffIds

  return patch
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const inB = new Set(b)
  return a.every((id) => inB.has(id))
}

/** True when the dialog can close without asking the API anything. */
export function isNoChange(patch: ServiceUpdateRequest): boolean {
  return Object.keys(patch).length === 0
}

/**
 * The live preview: `bufferBefore + duration + bufferAfter`, which is what the
 * response calls `totalBlockMinutes`.
 *
 * `undefined` while the duration is not a usable number, so the preview says
 * nothing rather than saying `NaN` — the field it depends on is the one somebody
 * is mid-way through typing.
 */
export function totalBlockPreview(
  values: Pick<ServiceFormValues, 'durationMinutes' | 'bufferBeforeMinutes' | 'bufferAfterMinutes'>,
): number | undefined {
  const duration = values.durationMinutes.trim()
  if (!wholeMinutes.test(duration) || Number(duration) === 0) return undefined

  return (
    minutesOf(values.bufferBeforeMinutes) + Number(duration) + minutesOf(values.bufferAfterMinutes)
  )
}
