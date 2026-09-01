import { bookingStatusSchema } from '@/api/schemas/booking'
import type { CalendarParams } from '@/features/calendar/calendar-params'
import { STATUS_STYLES } from '@/features/calendar/status-style'
import type { Lookups } from '@/hooks/use-lookups'
import type { Staff } from '@/types'

/**
 * Colleague and status, both in the URL so a filtered week is a link.
 *
 * Native `<select>`s, deliberately, on the screen where a custom listbox would
 * cost the most: this toolbar is the busiest row of controls in the app and both
 * lists are short. The platform control is already keyboard-accessible, already
 * announces itself correctly, and on a phone opens the operating system's own
 * picker — which is better than anything worth building here.
 *
 * Both lists include everybody and every status, archived and terminal ones
 * included. A calendar is read backwards as often as forwards, and a filter that
 * could not select "no-show" or a colleague who has since left would be unable
 * to answer the question those filters exist for.
 */
export function CalendarFilters({ params, lookups }: { params: CalendarParams; lookups: Lookups }) {
  const staff = [...lookups.staffById.values()].sort((a: Staff, b: Staff) =>
    a.fullName.localeCompare(b.fullName),
  )

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="calendar-staff">
        Filter by colleague
      </label>
      <select
        id="calendar-staff"
        value={params.staffId ?? ''}
        onChange={(event) =>
          params.setFilters({ staffId: event.target.value || undefined, status: params.status })
        }
        className="border-input bg-card text-foreground h-8 rounded-sm border px-2 text-xs"
      >
        <option value="">Everyone</option>
        {staff.map((person) => (
          <option key={person.id} value={person.id}>
            {person.fullName}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="calendar-status">
        Filter by status
      </label>
      <select
        id="calendar-status"
        value={params.status ?? ''}
        onChange={(event) =>
          params.setFilters({
            staffId: params.staffId,
            // The same parse the read path uses (`calendar-params.ts`), rather
            // than an assertion over a `<select>`'s string. "Any status" is the
            // empty option, which fails the parse and comes back `undefined` —
            // exactly what clearing the filter means.
            status: bookingStatusSchema.safeParse(event.target.value).data,
          })
        }
        className="border-input bg-card text-foreground h-8 rounded-sm border px-2 text-xs"
      >
        <option value="">Any status</option>
        {bookingStatusSchema.options.map((status) => (
          <option key={status} value={status}>
            {STATUS_STYLES[status].label}
          </option>
        ))}
      </select>
    </div>
  )
}
