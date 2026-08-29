import { UserRound, Users } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'

import { describeError, requestIdOf } from '@/api/error-copy'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { ANYONE } from '@/features/booking/booking-params'
import { useStaffForService } from '@/features/booking/public-queries'
import { StaffSkeleton } from '@/features/booking/skeletons'
import { cn } from '@/lib/utils'

type StaffStepProps = {
  slug: string
  serviceId: string
  onChoose: (staff: string, options?: { replace?: boolean }) => void
  /** Back to the service step, for the empty state's way out. */
  servicesHref: string
}

/**
 * Step 2 — who performs it.
 *
 * **"Anyone" is first and it is the default**, because it is the option that
 * finds the most slots. Picking a person is the narrowing choice, and putting it
 * second is the difference between a customer seeing a week of availability and
 * seeing one stylist's Tuesday.
 *
 * When it is chosen the booking request omits `staffId` entirely and the server
 * assigns. The client never picks on the server's behalf — not even by lifting
 * an id out of a slot's `staffIds`, which is a union of who *could* take it
 * rather than an instruction, and sending one back removes the server's ability
 * to balance the work across the team.
 */
export function StaffStep({ slug, serviceId, onChoose, servicesHref }: StaffStepProps) {
  const { data, isPending, isError, error, refetch } = useStaffForService(slug, serviceId)
  const onlyOne = data?.length === 1

  /**
   * A service exactly one person performs skips this step rather than showing a
   * one-option list — a question with a single answer is not a question.
   *
   * `replace`, so the back button from step 3 returns to the service step
   * instead of landing here and being bounced forward again, which is a trap
   * rather than a redirect. `ANYONE` rather than that person's id, because the
   * outcome is identical — the server has one candidate — and it keeps the
   * "client never names a staff member it was not told to" rule with no
   * exception to remember.
   */
  useEffect(() => {
    if (onlyOne) onChoose(ANYONE, { replace: true })
  }, [onlyOne, onChoose])

  if (isPending || onlyOne) {
    return (
      <>
        <p role="status" className="sr-only">
          Loading who is available
        </p>
        <StaffSkeleton />
      </>
    )
  }

  if (isError) {
    return (
      <ErrorState
        title="The team could not be loaded"
        description={describeError(error)}
        requestId={requestIdOf(error)}
        onRetry={() => void refetch()}
      />
    )
  }

  if (data.length === 0) {
    // A real state, not a bug: a service can exist with nobody assigned to it,
    // and the engine will offer no slots for it either.
    return (
      <EmptyState
        icon={Users}
        title="Nobody is set up to perform this service"
        description="It cannot be booked at the moment. Another service may still be available."
        action={
          <Button asChild variant="outline">
            <Link to={servicesHref}>Choose another service</Link>
          </Button>
        }
      />
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <StaffOption
        label="Anyone"
        description="First available — usually the most times"
        icon={<Users className="size-4" aria-hidden="true" />}
        onClick={() => onChoose(ANYONE)}
        recommended
      />
      {data.map((member) => (
        <StaffOption
          key={member.id}
          label={member.displayName}
          icon={<Initials name={member.displayName} />}
          onClick={() => onChoose(member.id)}
        />
      ))}
    </div>
  )
}

function StaffOption({
  label,
  description,
  icon,
  onClick,
  recommended,
}: {
  label: string
  description?: string
  icon: React.ReactNode
  onClick: () => void
  recommended?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group border-border bg-card flex items-center gap-3 rounded-md border p-4 text-left transition-colors',
        'hover:border-primary hover:bg-primary-wash',
      )}
    >
      <span
        className={cn(
          'inline-flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-medium',
          recommended ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="text-foreground block truncate text-sm font-medium">{label}</span>
        {description ? (
          <span className="text-muted-foreground block text-xs">{description}</span>
        ) : null}
      </span>
    </button>
  )
}

/**
 * Initials, from the only name this endpoint returns.
 *
 * `displayName` is deliberately all the public staff payload carries — no email
 * and no role — so there is nothing else to build an avatar from, and nothing
 * else should be fetched to try.
 */
function Initials({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => [...part][0] ?? '')
    .join('')
    .toUpperCase()

  if (!initials) return <UserRound className="size-4" aria-hidden="true" />
  return <span aria-hidden="true">{initials}</span>
}
