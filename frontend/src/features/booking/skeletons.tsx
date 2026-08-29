import { Skeleton } from '@/components/ui/skeleton'

/**
 * One skeleton per surface, each holding the geometry of the thing it replaces
 * (F20).
 *
 * The rule that makes these worth writing rather than reaching for a spinner:
 * the placeholder has to occupy the same space as the content, or the page jumps
 * when data lands and the skeleton has reintroduced exactly the reflow it was
 * meant to remove. So the card grid below is the same grid at the same
 * breakpoints, the week table is seven rows because a week has seven days, and
 * the slot grid's chips are the size a slot chip actually is.
 *
 * They are `aria-hidden` by way of the `Skeleton` atom; the live region beside
 * each one is what announces loading.
 */

/** The landing page: hero, opening hours, six service cards. */
export function LandingSkeleton() {
  return (
    <div className="pb-16">
      <div className="pt-10 pb-8">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-11 w-[min(28rem,90%)]" />
        <Skeleton className="mt-3 h-4 w-48" />
      </div>

      {/* The same two columns in the same order as the page — the catalogue in
          the `1fr`, the timetable in the fixed 18rem. A skeleton whose columns
          are the other way round is the reflow this component exists to
          prevent. */}
      <div className="grid gap-10 lg:grid-cols-[1fr_18rem] lg:gap-14">
        <div>
          <Skeleton className="h-3 w-20" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="border-border rounded-md border p-5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-2 h-3.5 w-full" />
                <Skeleton className="mt-1.5 h-3.5 w-2/3" />
                <div className="mt-6 flex justify-between">
                  <Skeleton className="h-3 w-14" />
                  <Skeleton className="h-4 w-16" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <Skeleton className="h-3 w-28" />
          <div className="mt-4">
            {/* Seven, because a week has seven days and six would resize. */}
            {Array.from({ length: 7 }, (_, index) => (
              <div key={index} className="border-rule flex justify-between border-b py-2.5">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3.5 w-24" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Step 2: "Anyone" plus a roster whose length is unknown, so three rows. */
export function StaffSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="border-border flex items-center gap-3 rounded-md border p-4">
          <Skeleton className="size-9 rounded-full" />
          <Skeleton className="h-4 w-28" />
        </div>
      ))}
    </div>
  )
}

/**
 * Step 3: three days of chips.
 *
 * Not seven. A quiet business's week has two or three days with anything in it,
 * and a skeleton that promises seven full days and delivers two is a bigger jump
 * than one that under-promises.
 */
export function SlotGridSkeleton() {
  return (
    <div className="space-y-8">
      {Array.from({ length: 3 }, (_, day) => (
        <div key={day}>
          <div className="border-rule flex items-center gap-3 border-b pb-2">
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="mt-4 space-y-4">
            {Array.from({ length: 2 }, (_, part) => (
              <div key={part}>
                <Skeleton className="h-3 w-20" />
                <div className="mt-2 flex flex-wrap gap-2">
                  {Array.from({ length: 8 }, (_, chip) => (
                    <Skeleton key={chip} className="h-9 w-[4.5rem]" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
