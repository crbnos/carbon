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
