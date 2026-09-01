import { UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { isApiError } from '@/api/error'
import { describeError, referenceNote, requestIdOf } from '@/api/error-copy'
import { Container } from '@/components/container'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/use-auth'
import { DeactivationWarning } from '@/features/staff/deactivation-warning'
import { InviteDialog } from '@/features/staff/invite-dialog'
import { StaffEditDialog } from '@/features/staff/staff-edit-dialog'
import { StaffRow } from '@/features/staff/staff-row'
import { activeOwnerCount, LAST_OWNER_COPY } from '@/features/staff/staff-state'
import { useResendInvitation, useTeam, useUpdateStaff } from '@/features/staff/team-queries'
import { useLookups } from '@/hooks/use-lookups'
import type { DeactivationWarning as Warning, MeResponse, Staff } from '@/types'

/**
 * Screen 8's first half: who performs the work.
 *
 * Owner-only, like the catalogue, and for the same reason — the demo's last step
 * requires a `STAFF` session to be redirected away from this URL, not merely to
 * find the buttons missing. `/team/:id/hours` stays shared, because that *is* a
 * staff member's own screen and their nav links straight to it.
 *
 * The screen's centre of gravity is not the list. It is the alert that appears
 * after a deactivation: `PATCH /api/staff/{id}` answers with
 * `{ staff, warning? }`, and `warning` carries the count of appointments the
 * person still has ahead of them and when the next one is. Deactivating somebody
 * mid-week is a real decision with consequences the owner cannot see from here,
 * and the API hands over the numbers to present it. Showing that in a toast would
 * throw away the one piece of information on this screen that somebody needs to
 * read twice.
 */
export function TeamPage() {
  const { user } = useAuth()

  if (!user) return null

  return <Team user={user} />
}

function Team({ user }: { user: MeResponse }) {
  const team = useTeam()
  const lookups = useLookups()
  const update = useUpdateStaff()
  const resend = useResendInvitation()

  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<Staff | null>(null)
  /**
   * The consequence of the last deactivation, kept until it is dismissed or
   * undone.
   *
   * Held here rather than in the mutation, because it has to outlive the request
   * — that is the entire point of it — and because a second deactivation should
   * replace it rather than stack a second alert on top.
   */
  const [warned, setWarned] = useState<{ person: Staff; warning: Warning } | null>(null)

  const rows = team.data ?? []

  /** Which row is mid-write, so only that row dims rather than the whole list. */
  const busyId = update.isPending
    ? update.variables?.id
    : resend.isPending
      ? resend.variables?.id
      : undefined

  function setActive(person: Staff, active: boolean) {
    update.mutate(
      { id: person.id, request: { active } },
      {
        onSuccess: (result) => {
          if (result.warning) {
            setWarned({ person: result.staff, warning: result.warning })
            return
          }

          // A deactivation with no appointments ahead of it, or a reactivation.
          // Both are one-sentence facts, so both are toasts — the row behind has
          // already changed to match.
          if (active) {
            setWarned((current) => (current?.person.id === person.id ? null : current))
            toast.success(`${result.staff.fullName} can sign in again.`)
          } else {
            toast.success(`${result.staff.fullName} is deactivated.`, {
              description: 'They have no appointments ahead of them and cannot sign in.',
            })
          }
        },
        onError: (error) => {
          // The refusal this screen is required to explain in its own words. The
          // control is disabled when the list already shows one owner, so
          // reaching this means the list was stale — two tabs, or a colleague
          // demoted a moment ago — and the sentence has to stand on its own.
          if (isApiError(error, 'LAST_OWNER')) {
            toast.error('That is the only active owner.', { description: LAST_OWNER_COPY })
            return
          }
          toast.error(describeError(error), {
            description: referenceNote(error),
          })
        },
      },
    )
  }

  return (
    <Container className="pb-12">
      <PageHeader
        eyebrow="Admin"
        title="Team"
        description={describeTeam(rows, team.isPending)}
        actions={
          <Button onClick={() => setInviting(true)}>
            <UserPlus aria-hidden="true" />
            Invite colleague
          </Button>
        }
      />

      {warned ? (
        <DeactivationWarning
          person={warned.person}
          warning={warned.warning}
          timeZone={user.business.timezone}
          undoing={update.isPending && update.variables?.id === warned.person.id}
          onUndo={() => setActive(warned.person, true)}
          onDismiss={() => setWarned(null)}
        />
      ) : null}

      {team.isPending ? (
        <TeamSkeleton />
      ) : team.error && team.data === undefined ? (
        <ErrorState
          title="Your team could not be loaded"
          description={describeError(team.error)}
          requestId={requestIdOf(team.error)}
          onRetry={() => void team.refetch()}
        />
      ) : rows.length === 0 ? (
        // Not reachable in practice — the signed-in owner is a member of their
        // own team, so this list always has at least one row. Rendered anyway,
        // because "not reachable" is not a thing to leave a bordered strip of
        // nothing behind.
        <EmptyState
          icon={Users}
          title="Nobody here yet"
          description="Invite the people who take appointments. They get an email, choose their own password, and appear on the calendar."
          action={
            <Button onClick={() => setInviting(true)}>
              <UserPlus aria-hidden="true" />
              Invite colleague
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-2">
          {rows.map((person) => (
            <StaffRow
              key={person.id}
              person={person}
              team={rows}
              lookups={lookups}
              busy={busyId === person.id}
              onEdit={setEditing}
              onResend={(target) => resend.mutate(target)}
              onDeactivate={(target) => setActive(target, false)}
              onReactivate={(target) => setActive(target, true)}
            />
          ))}
        </ul>
      )}

      {inviting ? <InviteDialog onClose={() => setInviting(false)} /> : null}

      {editing ? (
        <StaffEditDialog
          key={editing.id}
          person={editing}
          team={rows}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Container>
  )
}

/**
 * "Four colleagues, two of them owners." — the header's one line.
 *
 * Counts rather than a static sentence, because the owner count is the number
 * behind every disabled Deactivate button on the screen, and reading it in the
 * header is how somebody works out why.
 */
function describeTeam(team: readonly Staff[], loading: boolean): string {
  if (loading) return 'Who performs the work, and what each of them can do.'

  const active = team.filter((person) => person.active).length
  const owners = activeOwnerCount(team)

  const people = `${active} ${active === 1 ? 'person' : 'people'} can sign in`
  const ownership = owners === 1 ? 'one of them an owner' : `${owners} of them owners`
  return `${people}, ${ownership}. Deactivated colleagues and outstanding invitations are listed too.`
}

/** The shape of the roster, not a spinner (F20). */
function TeamSkeleton() {
  return (
    <div className="grid gap-2">
      <span className="sr-only" role="status">
        Loading your team
      </span>
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="border-border bg-card rounded-md border px-4 py-3">
          <div className="flex items-start gap-4">
            <Skeleton className="size-9 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="mt-2 h-3 w-52" />
              <Skeleton className="mt-2 h-3 w-64" />
            </div>
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}
