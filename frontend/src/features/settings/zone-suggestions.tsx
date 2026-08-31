import { memo } from 'react'

import { browserZones } from '@/features/settings/zones'

/**
 * The timezone field's suggestion list, rendered once.
 *
 * `memo` is doing real work here rather than being defensive. The list is around
 * six hundred entries — the whole tz database this browser ships — and without
 * it React reconciles six hundred `<option>` nodes on every keystroke anywhere
 * in the settings form, including the deposit percentage three fields below. The
 * data never changes while the page is open, so the only prop is the id the
 * input points at.
 */
export const ZoneSuggestions = memo(function ZoneSuggestions({ id }: { id: string }) {
  return (
    <datalist id={id}>
      {browserZones().map((zone) => (
        <option key={zone} value={zone} />
      ))}
    </datalist>
  )
})
