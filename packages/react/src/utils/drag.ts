// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export type DragSample = { y: number; t: number };

const VELOCITY_WINDOW_MS = 100;
const RUBBER_BAND_RESISTANCE = 0.2;

export function addDragSample(
  samples: DragSample[],
  sample: DragSample
): DragSample[] {
  return [
    ...samples.filter((s) => sample.t - s.t <= VELOCITY_WINDOW_MS),
    sample
  ];
}

/**
 * The finger's speed as it lifted, in px per ms, downward positive. A
 * `pointerup` reports the same position as the last `pointermove`, so the speed
 * has to come from the moves; a finger that rested before lifting has none.
 */
export function releaseVelocity(
  samples: DragSample[],
  releasedAt: number
): number {
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last || last.t <= first.t) return 0;
  if (releasedAt - last.t > VELOCITY_WINDOW_MS) return 0;
  return (last.y - first.y) / (last.t - first.t);
}

export function rubberBand(distance: number, max: number): number {
  return max * (1 - 1 / (1 + (distance * RUBBER_BAND_RESISTANCE) / max));
}
