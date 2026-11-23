// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import type { MotionKeyframes, Pose } from "./keyframes";
import type { AssemblyStep, Motion } from "./types";

export const IDENTITY_POSE: Pose = {
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1]
};

export function positionAt(
  keyframes: MotionKeyframes,
  index: number
): number[] {
  return keyframes.positions.slice(index * 3, index * 3 + 3);
}

export function quaternionAt(
  keyframes: MotionKeyframes,
  index: number
): number[] {
  return keyframes.quaternions.slice(index * 4, index * 4 + 4);
}

export function lastIndex(keyframes: MotionKeyframes): number {
  return keyframes.times.length - 1;
}

export function expectVectorClose(actual: number[], expected: number[]) {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index] ?? Number.NaN, 6);
  });
}

export function expectMonotonicTimes(keyframes: MotionKeyframes) {
  expect(keyframes.times[0]).toBe(0);
  for (let i = 1; i < keyframes.times.length; i++) {
    expect(keyframes.times[i]).toBeGreaterThan(
      keyframes.times[i - 1] ?? Number.POSITIVE_INFINITY
    );
  }
}

export function makeStep(
  motion: Motion,
  componentNodeIds: string[]
): AssemblyStep {
  return {
    id: "step-1",
    title: null,
    instructionText: null,
    componentNodeIds,
    motion,
    camera: null,
    fastener: null
  };
}
