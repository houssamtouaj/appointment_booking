import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { bookingKeys, patchBookingStatus } from '@/api/bookings'
import { dashboardKeys } from '@/api/dashboard'
import { isApiError, problemMember } from '@/api/error'
import { describeError, referenceNote } from '@/api/error-copy'
import { statusWord } from '@/features/calendar/status-style'
import type { BookingStatus, StaffTransition } from '@/types'

/**
 * `PATCH /api/bookings/{id}/status`, applied before the server answers (F14).
 *
 * **The only optimistic mutation in the project**, and the exception is argued
 * rather than assumed. Two things have to be true for optimism to be worth its
 * complexity: the latency has to be visible, and the rollback has to be cheap.
 * Here both are — a person marking off six appointments at the end of the day
 * watches every one of them wait for a round trip, and what is being guessed is
 * one enum on one row that the server will send back anyway. Everywhere else in
 * this app a mutation creates something, changes money, or cannot be undone by
 * writing a previous value back, and none of those qualify.
 */

/** Every cached shape a booking can be sitting in, patched by one function. */
type Patchable = { id: string; status: BookingStatus }

/**
 * The three guards that let the patch below narrow rather than assert.
 *
 * Cache entries arrive as `unknown` — deliberately, since the whole approach is
 * to patch whatever shape is found rather than to name the queries expected to
 * exist — and the alternative was three `as` expressions guarded by
 * `Array.isArray` and `'id' in cached` next door. Same runtime checks, said once
 * and in the type system.
 */
function isPatchable(value: unknown): value is Patchable {
  return typeof value === 'object' && value !== null && 'id' in value && 'status' in value
}

function isPatchableList(value: unknown): value is Patchable[] {
  return Array.isArray(value) && value.every(isPatchable)
}

function isPatchablePage(value: unknown): value is { content: Patchable[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'content' in value &&
    isPatchableList((value as { content: unknown }).content)
  )
}

/**
 * Rewrite one booking's status wherever it is cached.
 *
 * The same booking is in up to three places at once — the week grid's array,
 * the list view's page envelope, and the sheet's own detail — and a patch that
 * missed one would show a tile change while the sheet it was changed from still
 * said the old thing. So this walks every entry under `bookings` and edits the
 * shape it finds, rather than naming the queries it expects to exist.
 */
function patchCachedStatus(client: QueryClient, id: string, status: BookingStatus): void {
  client.setQueriesData({ queryKey: bookingKeys.all }, (cached: unknown) => {
    if (!cached) return cached

    const edit = <T extends Patchable>(row: T): T => (row.id === id ? { ...row, status } : row)

    if (isPatchableList(cached)) return cached.map(edit)
    if (isPatchablePage(cached)) return { ...cached, content: cached.content.map(edit) }
    if (isPatchable(cached)) return edit(cached)

    return cached
  })
}

/**
 * The copy for a refused transition, naming the transition it refused.
 *
 * A gate item, and the reason is that the generic sentence is useless here.
 * "Something went wrong" after pressing *Completed* leaves a person pressing it
 * again; "A cancelled booking cannot be marked completed" tells them the row is
 * not what they thought it was, which is almost always what has actually
 * happened — somebody else cancelled it while this tab sat open.
 *
 * `from` and `to` are problem members the backend attaches at the throw site
 * (`IllegalBookingTransitionException`), precisely so a client that has
 * optimistically flipped a badge can say what the server thinks the status is.
 * They are read defensively — there is no published schema for an error body
 * (see `schemas/registry.ts`), so a member that stopped arriving must degrade to
 * the server's own prose rather than to the word `undefined` on screen.
 */
function describeRefusal(error: unknown, attempted: StaffTransition): string {
  if (!isApiError(error, 'ILLEGAL_TRANSITION')) {
    return describeError(error)
  }

  const from = problemMember(error, 'from')
  // `from` is the half that cannot be reconstructed — it is what the server
  // believes the booking is *now*, and the whole reason this sentence is worth
  // writing. Without it there is nothing to say that the server's own prose does
  // not already say better.
  if (typeof from !== 'string') return error.detail

  // `to` can be: the button that was pressed is a perfectly good stand-in, and
  // it is what the request asked for.
  const to = problemMember(error, 'to')
  const target = typeof to === 'string' ? to : attempted

  return `A ${statusWord(from)} booking cannot be marked ${statusWord(target)}.`
}

export type StatusChange = { id: string; status: StaffTransition }

export function useStatusMutation() {
  const client = useQueryClient()

  return useMutation({
    mutationFn: ({ id, status }: StatusChange) => patchBookingStatus(id, status),

    /**
     * Cancel, snapshot, patch — and the cancel is the line most easily left out.
     *
     * This screen refetches on window focus. Without `cancelQueries`, a refetch
     * already in flight when the button is pressed lands *after* the optimistic
     * patch and overwrites it with the pre-change server state, so the tile
     * flips back for a moment and then flips forward again when the mutation
     * answers. It reads as a glitch and it is a race, not a rendering bug.
     */
    onMutate: async ({ id, status }: StatusChange) => {
      await client.cancelQueries({ queryKey: bookingKeys.all })

      // The whole subtree, entry by entry, so the restore in `onError` puts
      // every cache back exactly as it was rather than reconstructing one.
      const snapshot = client.getQueriesData({ queryKey: bookingKeys.all })
      patchCachedStatus(client, id, status)
      return { snapshot }
    },

    onError: (error, variables, context) => {
      for (const [key, data] of context?.snapshot ?? []) {
        client.setQueryData(key, data)
      }

      toast.error(describeRefusal(error, variables.status), {
        description: referenceNote(error),
      })
    },

    onSuccess: (booking) => {
      // The server's own row, over the guess. It carries `updatedAt` and
      // anything else that moved with the status, and the guess covered one
      // field.
      client.setQueryData(bookingKeys.detail(booking.id), booking)
      toast.success(`Marked ${statusWord(booking.status)}.`)
    },

    /**
     * The dashboard as well as the calendar, and that is the half that gets
     * forgotten.
     *
     * `weekBookings`, `revenueCents` and `noShowRate` are all defined over
     * booking statuses in one SQL projection, so completing an appointment moves
     * three figures on a screen that is one click away. Leaving them stale means
     * an owner marks a booking done, opens the dashboard, and finds revenue
     * unchanged — which reads as the money being wrong rather than the cache
     * being old.
     */
    onSettled: () => {
      void client.invalidateQueries({ queryKey: bookingKeys.all })
      void client.invalidateQueries({ queryKey: dashboardKeys.all })
    },
  })
}

// ---------------------------------------------------------------------------
//  Time guards — an affordance, never a rule
// ---------------------------------------------------------------------------

/**
 * Why a transition cannot be offered yet, or `undefined` when it can.
 *
 * The API refuses `COMPLETED` before `endsAt` and `NO_SHOW` before `startsAt`,
 * because a completed appointment in the future is a data-quality bug that
 * resurfaces as a wrong number on the dashboard. Disabling those buttons with
 * the reason attached saves a person a round trip and a refusal they could not
 * have predicted.
 *
 * **It does not replace handling the 409, and must not.** Rule 1 says the client
 * holds no domain rules: this is a copy of the server's, it is evaluated against
 * *this browser's* clock, and a tab left open since this morning will happily
 * enable a button for an appointment that has since been cancelled by somebody
 * else. The guard is a courtesy; `describeRefusal` is the correctness.
 */
export function transitionBlockedReason(
  status: StaffTransition,
  booking: { startsAt: string; endsAt: string },
  now: Date = new Date(),
): string | undefined {
  const at = now.getTime()

  if (status === 'COMPLETED' && at < Date.parse(booking.endsAt)) {
    return 'An appointment can be marked completed once it has finished.'
  }
  if (status === 'NO_SHOW' && at < Date.parse(booking.startsAt)) {
    return 'A no-show can only be recorded once the appointment was due to start.'
  }
  return undefined
}
