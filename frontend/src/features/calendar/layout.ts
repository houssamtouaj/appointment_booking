/**
 * Two appointments at the same hour, laid out so that neither hides the other.
 *
 * **Overlaps are the normal case, not the edge case.** A salon with three chairs
 * runs three appointments at 14:00 every Saturday, and a grid that positions
 * tiles by time alone stacks them into one tile-shaped lie. So a day's bookings
 * are split into *clusters* of things that touch, and each cluster's width is
 * divided between however many columns that cluster needs.
 *
 * It is pure arithmetic on numbers, deliberately: it takes minutes and returns
 * fractions, knows nothing about the DOM, and is the one piece of this wave that
 * can be tested exhaustively without rendering anything (wave gate). Everything
 * zone-shaped happens before it — `minutesIntoDay` in `lib/time.ts` — so this
 * file has no opinion about timezones and cannot acquire one.
 */

/** What the caller hands in: an id to key by, and the two minute offsets. */
export type Span = {
  key: string
  /** Minutes into the day. May be negative — a booking can start before midnight. */
  start: number
  end: number
}

/**
 * One placed tile. `column` of `columns` inside its cluster, which is all the
 * renderer needs to turn into a `left` and a `width`.
 */
export type Placement = {
  key: string
  start: number
  end: number
  column: number
  columns: number
}

/**
 * The floor a booking occupies for layout purposes, in minutes.
 *
 * A zero-length booking should not exist and the API does not forbid one, and
 * under the half-open intervals below an empty interval overlaps nothing — so a
 * 10:00–10:00 row would be assigned to the same column as the 10:00–11:00
 * appointment it sits on top of, and would be invisible. Giving every booking at
 * least a minute of extent for the purposes of *clustering only* means the
 * degenerate row gets its own column and can be seen and clicked. It does not
 * change what the tile is drawn as; that is the renderer's minimum height, and a
 * separate decision.
 */
const MINIMUM_EXTENT_MINUTES = 1

/**
 * Clusters, then columns within each cluster.
 *
 * **Half-open intervals throughout**: `[start, end)`, so a 10:00–11:00 and an
 * 11:00–12:00 appointment do not overlap and both keep the full width. Touching
 * at an endpoint is the single most common arrangement on a working calendar —
 * back-to-back appointments with one person — and treating it as a collision
 * would halve the width of nearly every tile on the screen.
 *
 * The column search is first-fit rather than best-fit. It is what keeps a
 * chained run — A 09:00–10:00, B 09:30–10:30, C 10:00–11:00 — at two columns
 * instead of three: C fits back into the column A vacated. Best-fit would give
 * the same answer here and a different one on other shapes, and first-fit is the
 * one whose result a person can predict by reading down the day.
 *
 * The cluster is the unit the width is divided by, **not** the whole day. A day
 * with one triple-booked hour at 09:00 and one lone appointment at 17:00 leaves
 * the 17:00 tile full width; dividing by the day's maximum would render every
 * quiet afternoon at a third of the column for the sake of one busy morning.
 */
export function layOutSpans(spans: readonly Span[]): Placement[] {
  const ordered = [...spans].sort(byStartThenLongestThenKey)

  const placements: Placement[] = []
  // The cluster currently being filled: the placements in it, and one open end
  // per column. `columnEnds[i]` is where column i last became free.
  let cluster: Placement[] = []
  let columnEnds: number[] = []
  let clusterEnd = Number.NEGATIVE_INFINITY

  function closeCluster() {
    for (const placement of cluster) placement.columns = columnEnds.length
    placements.push(...cluster)
    cluster = []
    columnEnds = []
    clusterEnd = Number.NEGATIVE_INFINITY
  }

  for (const span of ordered) {
    const end = Math.max(span.end, span.start + MINIMUM_EXTENT_MINUTES)

    // A span starting at or after everything the cluster covers touches none of
    // it, so the cluster is finished and its width can be divided. `>=` and not
    // `>`: back-to-back appointments start a new cluster, which is what gives
    // them both the full width.
    if (span.start >= clusterEnd) closeCluster()

    // First column free at this span's start. `<=` for the same half-open
    // reason: a column whose last booking ended at 10:00 is free at 10:00.
    let column = columnEnds.findIndex((columnEnd) => columnEnd <= span.start)
    if (column === -1) column = columnEnds.length

    columnEnds[column] = end
    clusterEnd = Math.max(clusterEnd, end)
    // `columns` is a placeholder until the cluster closes and its width is
    // known. Writing 1 rather than 0 keeps the type honest if a caller ever
    // reads a placement mid-flight, which nothing does.
    cluster.push({ key: span.key, start: span.start, end: span.end, column, columns: 1 })
  }
  closeCluster()

  return placements
}

/**
 * Start, then longest first, then key.
 *
 * The first key is the algorithm's; the other two only decide what happens
 * between spans the first cannot separate, and both exist to make the answer
 * *stable*. Longest-first puts the appointment that constrains the cluster in
 * column 0, which reads better — the hour-long booking on the left, the
 * fifteen-minute one beside it. The key tiebreak is what stops two identical
 * ranges swapping columns between renders, which on a grid looks like the tiles
 * jumping for no reason every time anything refetches.
 */
function byStartThenLongestThenKey(a: Span, b: Span): number {
  if (a.start !== b.start) return a.start - b.start
  if (a.end !== b.end) return b.end - a.end
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

/** `column` of `columns` as the two percentages a tile is drawn with. */
export function frameOf(placement: Placement): { left: string; width: string } {
  const width = 100 / placement.columns
  return { left: `${placement.column * width}%`, width: `${width}%` }
}
