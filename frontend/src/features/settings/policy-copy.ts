import { translate, type TKey } from '@/i18n'
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
 *
 * Every count goes through a plural key rather than a `count === 1 ? '' : 's'`,
 * because French counts 0 with the singular. `translate` and not the hook: these
 * are plain functions, and the components that call them subscribe.
 */

/** What each value does, for the hint under its own input. */
export const POLICY_HINTS: Record<keyof PolicyRequest, TKey> = {
  minLeadTimeHours: 'settings.policy.minLeadTimeHint',
  maxAdvanceDays: 'settings.policy.maxAdvanceHint',
  cancellationCutoffHours: 'settings.policy.cutoffHint',
  slotGranularityMinutes: 'settings.policy.slotStepHint',
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
  return translate('settings.policy.summary', {
    lead: leadTime(policy.minLeadTimeHours),
    window: translate('settings.policy.dayCount', { count: policy.maxAdvanceDays }),
    step: policy.slotGranularityMinutes,
  })
}

/**
 * The cancellation cutoff as its own sentence rather than a fifth clause.
 *
 * It governs a different person doing a different thing — the customer, after
 * booking — and folding it into the line above produced a sentence nobody
 * finished reading.
 */
export function describeCutoff(hours: number): string {
  if (hours === 0) return translate('settings.policy.cutoffImmediate')
  return translate('settings.policy.cutoffBefore', {
    hours: translate('settings.policy.hourCount', { count: hours }),
  })
}

function leadTime(hours: number): string {
  if (hours === 0) return translate('settings.policy.leadImmediate')
  return translate('settings.policy.leadAhead', {
    hours: translate('settings.policy.hourCount', { count: hours }),
  })
}
