// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Bat flight paths for the bats that cross the app, as keyframes in screen
// pixels. A bat hunting at dusk never flies a straight line: it changes speed,
// jinks sideways, dips and climbs, and drifts nearer and farther. So every
// path is a random walk in position and in depth (`scale`), banking into each
// turn. Pure: the randomness comes from the `random` passed in.

import type { Random } from "./math";
import { clamp } from "./math";

export type Flight = {
  x: number[];
  y: number[];
  rotate: number[];
  scale: number[];
  opacity: number[];
};

/** Banks into the turn: the steeper the climb or dive, the harder the tilt. */
function bank(x: number[], y: number[]) {
  return x.map((_, i) => {
    const next = Math.min(i + 1, x.length - 1);
    const previous = Math.max(i - 1, 0);
    const dx = (x[next] ?? 0) - (x[previous] ?? 0);
    const dy = (y[next] ?? 0) - (y[previous] ?? 0);
    if (dx === 0) return 0;
    return clamp((Math.atan(dy / Math.abs(dx)) * 180) / Math.PI, -32, 32);
  });
}

/**
 * Across the screen, edge to edge, somewhere in its upper half. Speed varies
 * along the way and now and then the bat jinks hard up or down.
 */
export function crossing(
  width: number,
  height: number,
  leftToRight: boolean,
  random: Random
): Flight {
  const steps = 16;
  const from = leftToRight ? -110 : width + 110;
  const to = leftToRight ? width + 110 : -110;
  // Uneven strides: some stretches fast, some hovering.
  const strides = Array.from({ length: steps - 1 }, () => 0.4 + random() * 1.2);
  const total = strides.reduce((sum, stride) => sum + stride, 0);
  const x = [from];
  let travelled = 0;
  for (const stride of strides) {
    travelled += stride;
    x.push(from + ((to - from) * travelled) / total);
  }

  const top = height * 0.05;
  const bottom = height * 0.5;
  let level = top + random() * (bottom - top) * 0.7;
  let depth = 0.65 + random() * 0.6;
  const y: number[] = [];
  const scale: number[] = [];
  for (let i = 0; i < steps; i++) {
    const jink = random() < 0.22 ? (random() < 0.5 ? -1 : 1) * 70 : 0;
    level = clamp(level + (random() - 0.5) * 70 + jink, top, bottom);
    depth = clamp(depth + (random() - 0.5) * 0.4, 0.5, 1.5);
    y.push(level);
    scale.push(depth);
  }

  return {
    x,
    y,
    rotate: bank(x, y),
    scale,
    opacity: x.map(() => 1)
  };
}

/**
 * Straight at the viewer: the bat appears small in the distance, flutters
 * nearer and nearer, and sweeps past the edge of the screen, large.
 */
export function approach(
  width: number,
  height: number,
  random: Random
): Flight {
  const steps = 12;
  const startX = width * (0.25 + random() * 0.5);
  const startY = height * (0.15 + random() * 0.3);
  // It passes the viewer on one side, so it drifts out towards that edge.
  const side = startX < width / 2 ? -1 : 1;
  const exitX = side < 0 ? -260 : width + 260;
  const exitY = startY + (random() - 0.3) * height * 0.6;

  const x: number[] = [];
  const y: number[] = [];
  const scale: number[] = [];
  const opacity: number[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    // Perspective: the bat crosses most of the screen in the last moments.
    const ease = t ** 2.6;
    const wobble = (1 - t * 0.5) * 26;
    x.push(startX + (exitX - startX) * ease + (random() - 0.5) * wobble);
    y.push(startY + (exitY - startY) * ease + (random() - 0.5) * wobble);
    scale.push(0.14 + 3.1 * t ** 2.2);
    opacity.push(clamp(t * 5, 0, 1));
  }
  return {
    x,
    y,
    rotate: x.map(() => (random() - 0.5) * 30),
    scale,
    opacity
  };
}

/**
 * Off a toast: a few wingbeats straight up out of it, then each bat its own
 * way — some away into the distance, some past the viewer.
 */
export function takeOff(random: Random): Flight {
  const steps = 9;
  const side = random() < 0.5 ? -1 : 1;
  const towardViewer = random() < 0.4;
  let px = 0;
  let py = 0;
  const x = [0];
  const y = [0];
  for (let i = 1; i < steps; i++) {
    px += side * (6 + random() * 34) + (random() - 0.5) * 30;
    py -= 14 + random() * 36;
    x.push(px);
    y.push(py);
  }
  const scale = x.map((_, i) => {
    const t = i / (steps - 1);
    return towardViewer ? 0.7 + 1.8 * t ** 1.6 : 1.05 - 0.7 * t;
  });
  const opacity = x.map((_, i) =>
    i === 0 ? 0 : i === steps - 1 ? 0 : i === steps - 2 ? 0.7 : 1
  );
  return { x, y, rotate: bank(x, y), scale, opacity };
}
