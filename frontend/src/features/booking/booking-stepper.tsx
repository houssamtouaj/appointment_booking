import { Check } from 'lucide-react'
import { Link } from 'react-router-dom'

import {
  paramsForStep,
  stepOf,
  toSearch,
  type BookingParams,
  type BookingStep,
} from '@/features/booking/booking-params'
import { cn } from '@/lib/utils'

const STEPS: { id: BookingStep; label: string }[] = [
  { id: 'service', label: 'Service' },
  { id: 'staff', label: 'Who' },
  { id: 'slot', label: 'Time' },
]

type BookingStepperProps = {
  slug: string
  params: BookingParams
  /** What each answered step chose, for the line under its label. */
  summary: Partial<Record<BookingStep, string>>
  /** Set when step 2 answered itself — see `StaffStep`. */
  note?: Partial<Record<BookingStep, string>>
}

/**
 * Where you are in the flow, and the way back.
 *
 * **Backwards only.** A completed step is a link; the current step is plain
 * text; a step after it is neither, because there is nothing coherent to land on
 * — jumping to the slot picker without a service means fetching availability for
 * nothing. That is the whole rule, and it falls out of `stepOf` deriving the
 * step from the choices rather than storing a number that could disagree with
 * them.
 *
 * A step's link carries only the choices **up to** it (`paramsForStep`). Going
 * back to the service step and picking a different service must not keep the
 * staff member chosen for the previous one — they may not even perform it.
 *
 * The numbers earn their place here: this is a real sequence, and the count is
 * information a person uses to decide whether to start.
 */
export function BookingStepper({ slug, params, summary, note }: BookingStepperProps) {
  const current = stepOf(params)
  const currentIndex = STEPS.findIndex((step) => step.id === current)

  return (
    <nav aria-label="Booking steps" className="border-rule border-b pb-4">
      <ol className="flex items-start gap-2 sm:gap-6">
        {STEPS.map((step, index) => {
          const done = index < currentIndex
          const isCurrent = index === currentIndex
          const body = (
            <>
              <span
                className={cn(
                  'text-2xs inline-flex size-5 shrink-0 items-center justify-center rounded-xs font-mono',
                  done && 'bg-primary text-primary-foreground',
                  isCurrent && 'bg-primary-wash text-primary',
                  !done && !isCurrent && 'bg-muted text-muted-foreground',
                )}
              >
                {done ? (
                  <Check className="size-3" aria-hidden="true" />
                ) : (
                  String(index + 1).padStart(2, '0')
                )}
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    'block text-sm',
                    isCurrent ? 'text-foreground font-medium' : 'text-muted-foreground',
                  )}
                >
                  {step.label}
                </span>
                {/* The chosen value, hidden at 375px where three columns of it
                    would wrap into an unreadable stack. */}
                {summary[step.id] ? (
                  <span className="text-muted-foreground hidden max-w-36 truncate text-xs sm:block">
                    {summary[step.id]}
                  </span>
                ) : null}
                {note?.[step.id] ? (
                  <span className="text-muted-foreground hidden text-xs italic sm:block">
                    {note[step.id]}
                  </span>
                ) : null}
              </span>
            </>
          )

          return (
            <li key={step.id} className="flex min-w-0 flex-1 sm:flex-none">
              {done ? (
                <Link
                  to={`/b/${slug}/book${toSearch(paramsForStep(params, step.id))}`}
                  className="flex min-w-0 items-center gap-2 rounded-xs hover:opacity-80"
                >
                  {body}
                </Link>
              ) : (
                <span
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-disabled={!isCurrent || undefined}
                  className="flex min-w-0 items-center gap-2"
                >
                  {body}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
