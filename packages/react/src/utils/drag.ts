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

/** Read from the moves: a `pointerup` reports the last move's position. */
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

const FLICK_VELOCITY = 0.5;
const FLICK_MIN_DISTANCE_PX = 20;

export function shouldDismissSheet({
  offset,
  height,
  velocity
}: {
  offset: number;
  height: number;
  velocity: number;
}): boolean {
  return (
    offset > height / 3 ||
    (velocity > FLICK_VELOCITY && offset >= FLICK_MIN_DISTANCE_PX)
  );
}
