import { useEffect, useState } from 'react'

/**
 * The two questions a thirty-minute hold raises, as hooks.
 *
 * They live away from `hold-notice.tsx` because the notice is not the only
 * screen that has to agree with the clock: the manage page's whole status card
 * — its heading, its Stripe-return sentence and its pay button — is wrong the
 * moment the deadline passes, and a component file that also exported a hook
 * would cost that page its fast refresh.
 */

/**
 * Milliseconds until the deadline, re-read once a second, or `undefined` when
 * there is no deadline to count towards.
 *
 * A second rather than a minute because the last minute is the one anybody
 * watches, and a per-minute tick spends up to fifty-nine seconds telling
 * somebody they have a minute left after they no longer do.
 */
export function useRemaining(expiresAt: string | undefined): number | undefined {
  const deadline = expiresAt ? Date.parse(expiresAt) : Number.NaN
  const valid = !Number.isNaN(deadline)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    // Nothing to count towards, or nothing left of it. The copy is frozen at
    // "expired" from here on, so a tick would re-render once a second to
    // rewrite the same sentence.
    if (!valid || deadline - Date.now() <= 0) return
    const timer = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (deadline - current <= 0) window.clearInterval(timer)
    }, 1000)
    // Cleared on unmount too. This screen is one a customer leaves by being sent
    // to Stripe, and an interval left behind ticks for the life of the tab.
    return () => window.clearInterval(timer)
  }, [valid, deadline])

  return valid ? deadline - now : undefined
}

/**
 * Whether the hold is already over, for the screens that have to agree with the
 * notice rather than contradict it.
 *
 * A single timeout at the deadline rather than {@link useRemaining}'s
 * per-second tick: the answer changes exactly once, and the page asking is
 * re-rendering all of itself on it.
 *
 * The state is a *clock reading* rather than the answer, so nothing has to be
 * written during the first render to be correct on it: an already-expired hold
 * is expired the moment it is asked, with no effect involved and no cascading
 * second render before the browser has painted the first.
 */
export function useHoldExpired(expiresAt: string | undefined): boolean {
  const deadline = expiresAt ? Date.parse(expiresAt) : Number.NaN
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (Number.isNaN(deadline) || deadline <= now) return
    const timer = window.setTimeout(() => setNow(Date.now()), deadline - now)
    return () => window.clearTimeout(timer)
  }, [deadline, now])

  return !Number.isNaN(deadline) && deadline <= now
}
