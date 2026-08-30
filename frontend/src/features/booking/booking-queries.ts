import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { cancelBooking, createBooking, fetchBooking, publicKeys } from '@/api/public'
import type { BookingRequest, PublicBooking } from '@/types'

/**
 * The booking write, and the manage page's read.
 *
 * Kept out of `public-queries.ts` because they answer a different question: that
 * file is the catalogue and the calendar, cached for minutes at a time; a
 * booking is a single row whose status is the one thing on screen and can change
 * without anybody touching this tab.
 */

// ---------------------------------------------------------------------------
//  Creating one
// ---------------------------------------------------------------------------

/**
 * `POST .../bookings`.
 *
 * On success **every cached week of this business's availability is dropped**,
 * not just the one that was showing. A booking removes more than its own start:
 * the engine's setup and cleanup buffers take the neighbouring offers with it,
 * and a prefetched next week is as wrong as the current one. That is also what
 * makes the demo's third step honest — refetch the same week and the slot is
 * gone, "and so are the ones its buffers cover".
 *
 * The same invalidation runs on a `409`. Losing the race is the strongest
 * evidence there is that the week on screen is stale.
 */
export function useCreateBooking(slug: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: BookingRequest) => createBooking(slug, request),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: publicKeys.availabilityAll(slug) })
    },
  })
}

// ---------------------------------------------------------------------------
//  Reading one, and waiting for a webhook that has not landed yet
// ---------------------------------------------------------------------------

/** The first, impatient interval — a webhook usually beats the redirect by less than this. */
const POLL_FAST_MS = 2_000

/** What it backs off to. */
const POLL_SLOW_MS = 5_000

/** When it backs off. Ten fast polls is plenty of impatience. */
const POLL_BACKOFF_AFTER_MS = 20_000

/**
 * The whole window. Past this the page stops asking and offers a button.
 *
 * Ninety seconds rather than "until it changes", because a `PENDING` that has
 * not moved by then is not usually a slow webhook — it is an abandoned checkout,
 * and the sweeper will cancel it at the thirty-minute mark (backend D3). A page
 * that polls forever is a page making requests for the rest of the session.
 */
const POLL_WINDOW_MS = 90_000

/**
 * How long to wait before asking again, `false` for "stop".
 *
 * Exported and pure so the schedule can be asserted directly rather than
 * inferred from a test that waits ninety seconds.
 */
export function pollIntervalFor(elapsedMs: number): number | false {
  if (elapsedMs >= POLL_WINDOW_MS) return false
  return elapsedMs < POLL_BACKOFF_AFTER_MS ? POLL_FAST_MS : POLL_SLOW_MS
}

export type BookingByToken = ReturnType<typeof useBookingByToken>

/**
 * The manage page's query, including the wait for a deposit webhook.
 *
 * **A redirect is not a payment.** Stripe sends the customer back to
 * `?checkout=success` the moment their card is accepted, and the webhook that
 * actually confirms the booking is a separate request from Stripe to the API
 * that may land a second later. So the page reads the booking, and while it says
 * `PENDING` it asks again — every two seconds, backing off to five, for at most
 * ninety. The alternative, rendering "paid" from the query string, is the one
 * mistake this screen must not make; anyone can type that URL.
 *
 * Polling stops in three ways and all three matter: the moment the status is no
 * longer `PENDING`, at the ninety-second mark, and on unmount — the last of
 * those handed to TanStack Query, which tears the interval down with the
 * observer. A hand-rolled `setInterval` is how this page ends up polling for the
 * rest of the session from a route nobody is looking at.
 */
export function useBookingByToken(cancellationToken: string) {
  /**
   * When this page started waiting.
   *
   * A ref rather than state because changing it must not re-render, and it is
   * read from inside the interval callback where a stale closure over a
   * `useState` value would freeze the schedule at its first value.
   *
   * Filled on first *use* rather than at declaration, because `Date.now()` is
   * impure and calling it during render is exactly the thing that makes a
   * component's output depend on when React happened to run it. Every caller
   * below is an effect or an interval callback, so the clock is only ever read
   * outside render.
   */
  const startedAt = useRef<{ token: string; at: number } | null>(null)

  /**
   * **Which booking gave up, rather than whether one did.**
   *
   * `ManageBookingPage` is one route element, so moving from `/booking/A` to
   * `/booking/B` inside the app re-renders this hook rather than remounting it.
   * A plain boolean would still be A's, and B would arrive with the window
   * already closed: no "checking for your payment", the manual button from the
   * first paint, and not one automatic poll for a booking a webhook may confirm
   * a second later. Stamping it with the token it belongs to makes the reset
   * fall out of the comparison, with no effect to write it and no render in
   * which the two disagree.
   */
  const [gaveUpOn, setGaveUpOn] = useState<string | null>(null)
  const gaveUp = gaveUpOn === cancellationToken

  const elapsedMs = useCallback((): number => {
    // Stamped with the token for the same reason, and re-read here rather than
    // in a reset: this is the one place the window's start is used, and a
    // different booking has not started waiting yet.
    if (startedAt.current?.token !== cancellationToken) {
      startedAt.current = { token: cancellationToken, at: Date.now() }
    }
    return Date.now() - startedAt.current.at
  }, [cancellationToken])

  const query = useQuery({
    queryKey: publicKeys.booking(cancellationToken),
    queryFn: ({ signal }) => fetchBooking(cancellationToken, signal),
    /**
     * Zero, against the app-wide thirty seconds. This row is the entire screen
     * and it changes without this tab doing anything — a webhook confirms it, a
     * sweeper cancels it, the business marks it a no-show. Serving a cached copy
     * on a remount is how somebody refreshes the page to check and is shown the
     * same stale answer.
     */
    staleTime: 0,
    refetchInterval: (currentQuery) => {
      if (gaveUp) return false
      if (currentQuery.state.data?.status !== 'PENDING') return false
      return pollIntervalFor(elapsedMs())
    },
  })

  /**
   * The same deadline again, as a timer.
   *
   * It is not duplication: `refetchInterval` returning `false` stops the
   * requests but renders nothing, so without this the screen would sit on
   * "waiting for payment" with no button and no explanation, having silently
   * stopped waiting. This is what turns the stop into something visible.
   */
  const waiting = query.data?.status === 'PENDING'
  useEffect(() => {
    if (!waiting || gaveUp) return
    // Always a timer, never a synchronous `setGaveUp` for an already-elapsed
    // window: a state update in an effect body is a second render before the
    // browser has painted the first, and `Math.max` says the same thing without
    // one. It fires on the next tick when the window has already closed.
    const timer = window.setTimeout(
      () => setGaveUpOn(cancellationToken),
      Math.max(0, POLL_WINDOW_MS - elapsedMs()),
    )
    return () => window.clearTimeout(timer)
  }, [waiting, gaveUp, cancellationToken, elapsedMs])

  /**
   * The manual way on, after the window closed. One request, and it does not
   * restart the ninety seconds: a customer pressing a button is a better signal
   * than a timer, and re-arming the loop on every press is how "at most ninety
   * seconds" becomes "for as long as the tab is open".
   */
  const checkAgain = useCallback(() => {
    void query.refetch()
  }, [query])

  return {
    /**
     * Handed back whole rather than spread into this object, deliberately.
     * `UseQueryResult` is a discriminated union — `isPending` narrows `data` to
     * defined — and spreading it flattens the union into one object type where
     * `data` stays `T | undefined` forever. The page would then need a
     * non-null assertion on the one value it is built around.
     */
    query,
    /** True while the page is still asking on its own. Drives the copy, not the requests. */
    polling: waiting && !gaveUp,
    /** True once it has stopped asking and a `PENDING` booking is still on screen. */
    gaveUp,
    checkAgain,
  }
}

// ---------------------------------------------------------------------------
//  Cancelling
// ---------------------------------------------------------------------------

/**
 * `DELETE`, and the `200` it answers with replaces the cached booking directly.
 *
 * `setQueryData` rather than an invalidation, because the response *is* the
 * cancelled booking: refetching to learn what the server just told us is a round
 * trip spent to show a screen a moment later. It also carries
 * `depositRefundable`, which the page has to keep rendering after the cancel and
 * not only before it.
 */
export function useCancelBooking(cancellationToken: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => cancelBooking(cancellationToken),
    onSuccess: (booking: PublicBooking) => {
      queryClient.setQueryData(publicKeys.booking(cancellationToken), booking)
      // The slot is free the instant that commits — the exclusion constraint's
      // WHERE clause stops matching the row — so every cached week is wrong. The
      // manage page is reached from an email and knows no slug, so this matches
      // on the shape of the key instead: every availability query, whichever
      // business it belongs to. Deliberately not `publicKeys.all`, which is a
      // prefix of the booking key above and would refetch the row this callback
      // has just been handed.
      void queryClient.invalidateQueries({
        predicate: (cached) =>
          cached.queryKey[0] === publicKeys.all[0] && cached.queryKey[2] === 'availability',
      })
    },
  })
}
