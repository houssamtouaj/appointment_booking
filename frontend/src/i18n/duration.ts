import { translate } from '@/i18n'
import { splitDuration } from '@/lib/time'

/**
 * A duration in words: `"45 min"`, `"1 hr"`, `"1 hr 30 min"`, and in French
 * `"45 min"`, `"1 h"`, `"1 h 30 min"`.
 *
 * The plan for this wave put the three-way choice in each component that needed
 * it, having counted two such components. There are six — the booking flow, the
 * service card, the calendar sheet and two service screens — and two of them
 * reach it from a plain function rather than from a component, so a hook would
 * not serve them either. Written once here instead.
 *
 * It is `translate` and not `useTranslation` for that second reason: `describeBuffers`
 * in the calendar sheet and `describeTiming` in the service row are not
 * components. Their callers subscribe to the language, which is what re-renders
 * them.
 *
 * Lives in `i18n/` rather than in `lib/time.ts` because the arithmetic and the
 * wording are the two halves this wave deliberately split: `splitDuration` knows
 * that 90 minutes is one hour and thirty, and the dictionary knows what to call
 * it. Neither half knows the other's job.
 */
export function formatDurationText(minutes: number): string {
  const parts = splitDuration(minutes)
  if (parts.hours === 0) return translate('common.durationMinutes', { minutes: parts.minutes })
  if (parts.minutes === 0) return translate('common.durationHours', { hours: parts.hours })
  return translate('common.durationHoursMinutes', { hours: parts.hours, minutes: parts.minutes })
}
