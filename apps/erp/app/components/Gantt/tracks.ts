// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Pack bars that share one row into tracks: each bar takes the first track
 * whose last bar has ended by the time it starts. Bars that never overlap all
 * land on track 0, so a row of back-to-back work stays a single line; only an
 * overlap opens a second track. Returns each bar's track (input order) and
 * the number of tracks used.
 */
export function assignTracks(bars: { offset: number; duration: number }[]): {
  tracks: number[];
  trackCount: number;
} {
  const order = bars
    .map((bar, index) => ({ ...bar, index }))
    .sort((a, b) => a.offset - b.offset || b.duration - a.duration);
  const trackEnds: number[] = [];
  const tracks = new Array<number>(bars.length).fill(0);

  for (const bar of order) {
    let track = trackEnds.findIndex((end) => end <= bar.offset);
    if (track === -1) {
      track = trackEnds.length;
      trackEnds.push(0);
    }
    trackEnds[track] = bar.offset + bar.duration;
    tracks[bar.index] = track;
  }

  return { tracks, trackCount: Math.max(trackEnds.length, 1) };
}

/**
 * Merge bars into runs of overlapping time. Each group spans its bars and
 * lists them by input index; bars that only touch stay apart.
 */
export function groupOverlaps(bars: { offset: number; duration: number }[]): {
  offset: number;
  duration: number;
  indices: number[];
}[] {
  const order = bars
    .map((bar, index) => ({ ...bar, index }))
    .sort((a, b) => a.offset - b.offset);
  const groups: { offset: number; end: number; indices: number[] }[] = [];
  for (const bar of order) {
    const last = groups[groups.length - 1];
    if (last && bar.offset < last.end) {
      last.end = Math.max(last.end, bar.offset + bar.duration);
      last.indices.push(bar.index);
    } else {
      groups.push({
        offset: bar.offset,
        end: bar.offset + bar.duration,
        indices: [bar.index]
      });
    }
  }
  return groups.map(({ offset, end, indices }) => ({
    offset,
    duration: end - offset,
    indices
  }));
}

type Interval = { start: number; end: number };

/**
 * Each row's non-working time: its own entry in `byRow`, else its nearest
 * ancestor's (a station's operations keep the station's hours), else
 * `fallback`. A row above rows with their own hours (the location rollup)
 * gets none: it spans stations that keep different hours.
 */
export function rowNonWorkingIntervals(
  rows: { id: string; parentId?: string }[],
  byRow: Record<string, Interval[]>,
  fallback: Interval[] | undefined
): Map<string, Interval[] | undefined> {
  const parentOf = new Map(rows.map((row) => [row.id, row.parentId]));
  const rollups = new Set<string>();
  for (const id of Object.keys(byRow)) {
    for (let up = parentOf.get(id); up !== undefined; up = parentOf.get(up)) {
      rollups.add(up);
    }
  }
  const result = new Map<string, Interval[] | undefined>();
  for (const row of rows) {
    let id: string | undefined = row.id;
    while (id !== undefined && !byRow[id]) id = parentOf.get(id);
    result.set(
      row.id,
      id !== undefined ? byRow[id] : rollups.has(row.id) ? undefined : fallback
    );
  }
  return result;
}
