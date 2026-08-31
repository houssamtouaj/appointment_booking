import type { PolicyRequest } from '@/types'

/**
 * The four numbers, said back as one sentence.
 *
 * This exists because four independent integers are hard to hold in your head,
 * and this is the one screen where getting them wrong is invisible until nobody
 * can book. "2, 60, 24, 15" tells an owner nothing; "customers can book from 2
 * hours ahead up to 60 days out, in 15-minute steps" is a claim they can
 * recognise as wrong.
 *
 * Pure, and separate from the form, so the phrasing of every edge — zero lead
 * time, a one-day window, a cutoff of nothing — is testable without a render.
 */

/** What each value does, for the hint under its own input. */
export const POLICY_HINTS: Record<keyof PolicyRequest, string> = {
  minLeadTimeHours:
    'The soonest someone can book. 2 hours means nothing today after 4pm for a 6pm slot.',
  maxAdvanceDays: 'How far ahead the calendar is open.',
  cancellationCutoffHours: 'After this, a customer can no longer cancel themselves.',
  slotGranularityMinutes: 'The step between offered start times.',
}

/**
 * The three numbers the sentence reads, and no narrower.
 *
 * Deliberately not `PolicyRequest`, whose `slotGranularityMinutes` is the closed
 * six-value enum: this describes the *response* as often as the draft, and the
 * response is a plain integer for the reason `policySchema` gives — a server
 * that starts sending a seventh value should be described accurately, not
 * refused by a type on a sentence.
 */
type PolicyNumbers = {
  minLeadTimeHours: number
  maxAdvanceDays: number
  slotGranularityMinutes: number
}

export function describePolicy(policy: PolicyNumbers): string {
  return `Customers can book ${leadTime(policy.minLeadTimeHours)} up to ${window(policy.maxAdvanceDays)} out, in ${policy.slotGranularityMinutes}-minute steps.`
}

/**
 * The cancellation cutoff as its own sentence rather than a fifth clause.
 *
 * It governs a different person doing a different thing — the customer, after
 * booking — and folding it into the line above produced a sentence nobody
 * finished reading.
 */
export function describeCutoff(hours: number): string {
  if (hours === 0) return 'They can cancel themselves right up to the start time.'
  return `They can cancel themselves until ${plural(hours, 'hour')} before the appointment; after that, only you can.`
}

function leadTime(hours: number): string {
  if (hours === 0) return 'right up to the start time'
  return `from ${plural(hours, 'hour')} ahead`
}

function window(days: number): string {
  return plural(days, 'day')
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`
}
