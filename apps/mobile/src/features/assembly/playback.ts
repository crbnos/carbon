// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Motion } from "@carbon/viewer/types";
import { motionDurationMs } from "./stepMotion";

/**
 * The player's timeline.
 *
 * Web's `AssemblyPlayer` lays every step on ONE continuous timeline and
 * shows a scrubber over it — the clock reads `0:15 / 0:19`, not "step 8 of
 * 10 at 70%". So the native player needs the same thing: per-step
 * durations, the time each step starts at, and a total.
 *
 * It is all derived from the motions, with no state, so the bar and the
 * scene cannot disagree about how long a step takes.
 */

/**
 * The beat held on a seated step before the next one starts.
 *
 * Most steps in real data carry no authored motion — every step of every
 * demo assembly is `none` — so their synthesized insertion is short. Back to
 * back the whole build plays in a couple of seconds and reads as a flicker
 * rather than a sequence.
 */
export const STEP_DWELL_MS = 600;

/** How long one step occupies the playhead: its insertion, then the dwell. */
export function stepHoldMs(motion: Motion | null | undefined) {
  return motionDurationMs(motion) + STEP_DWELL_MS;
}

/**
 * Each step's start time on the shared timeline, plus the total.
 *
 * `starts[i]` is where step `i` begins; `starts` has one entry per step and
 * `total` is the end of the last, so `starts[i] + holds[i]` never exceeds it.
 */
export function timeline(holds: number[]) {
  const starts: number[] = [];
  let elapsed = 0;
  for (const hold of holds) {
    starts.push(elapsed);
    elapsed += hold;
  }
  return { starts, total: elapsed };
}

/**
 * `m:ss`, the format web's player uses.
 *
 * Seconds are FLOORED, so the clock never shows a total it has not reached —
 * rounding made a 19.4s build read `0:19 / 0:19` with a step still to play.
 */
export function formatClock(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * How much of a step has played, 0..1, for the segment under the playhead.
 *
 * Clamped at both ends: a step with no hold at all is reported complete
 * rather than dividing by zero.
 */
export function stepProgress(elapsedInStep: number, hold: number) {
  if (hold <= 0) return 1;
  return Math.min(1, Math.max(0, elapsedInStep / hold));
}

/** The step a point on the timeline belongs to, for a scrub. */
export function indexAtTime(starts: number[], holds: number[], ms: number) {
  if (starts.length === 0) return 0;
  for (let i = starts.length - 1; i >= 0; i--) {
    if (ms >= (starts[i] ?? 0)) return i;
  }
  return 0;
}

/**
 * Where a tap on the scrubber lands, as a step index.
 *
 * A tap is a position along the WHOLE bar, and the segments are not equal
 * widths — a step with a long insertion owns more of it — so this cannot be
 * `floor(fraction * stepCount)`. Getting that wrong puts the operator on a
 * neighbouring step whenever the durations differ, which is always.
 */
export function indexAtFraction(
  starts: number[],
  holds: number[],
  total: number,
  fraction: number
) {
  const clamped = Math.min(1, Math.max(0, fraction));
  return indexAtTime(starts, holds, clamped * total);
}
