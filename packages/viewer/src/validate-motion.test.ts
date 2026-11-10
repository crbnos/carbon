// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { motionToKeyframes } from "./keyframes";
import { IDENTITY_POSE } from "./test-utils";
import type { Motion } from "./types";
import { isPlayableMotion } from "./validate-motion";

describe("isPlayableMotion", () => {
  it("accepts the motion types the player animates", () => {
    expect(isPlayableMotion({ type: "none" })).toBe(true);
    expect(
      isPlayableMotion({ type: "linear", direction: [0, 0, 1], distance: 5 })
    ).toBe(true);
    expect(
      isPlayableMotion({
        type: "waypoints",
        waypoints: [
          { offset: [0, 0, 5], rotation: [0, 0, 0, 1] },
          { offset: [0, 0, 0], rotation: [0, 0, 0, 1] }
        ]
      })
    ).toBe(true);
  });

  it("rejects what would throw or is unknown", () => {
    expect(isPlayableMotion(null)).toBe(false);
    expect(isPlayableMotion({ type: "teleport" })).toBe(false);
    expect(
      isPlayableMotion({
        type: "waypoints",
        waypoints: [{ offset: [0, 0, 0], rotation: [0, 0, 0, 1] }]
      })
    ).toBe(false);
    expect(isPlayableMotion({ type: "path", keyframes: [] })).toBe(false);
  });

  const key = (t: number) => ({
    t,
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1]
  });

  it("rejects fields keyframe generation would turn into NaN", () => {
    expect(isPlayableMotion({ type: "linear", direction: [0, 0, 1] })).toBe(
      false
    );
    expect(
      isPlayableMotion({ type: "linear", direction: [0, 1], distance: 5 })
    ).toBe(false);
    expect(
      isPlayableMotion({
        type: "linear",
        direction: [0, 0, Number.NaN],
        distance: 5
      })
    ).toBe(false);
    expect(
      isPlayableMotion({
        type: "L",
        segments: [{ direction: [0, 0, 1], distance: "5" }]
      })
    ).toBe(false);
    expect(
      isPlayableMotion({
        type: "helix",
        axis: [0, 0, 1],
        origin: [0, 0, 0],
        pitch: 1,
        turns: 2
      })
    ).toBe(false);
    expect(
      isPlayableMotion({
        type: "waypoints",
        waypoints: [
          { offset: [0, 0, 5], rotation: [0, 0, 1] },
          { offset: [0, 0, 0], rotation: [0, 0, 0, 1] }
        ]
      })
    ).toBe(false);
    expect(
      isPlayableMotion({
        type: "waypoints",
        waypoints: [{ offset: [0, 0, 5] }, { offset: [0, 0, 0] }]
      })
    ).toBe(false);
  });

  it("rejects path keyframes that don't run 0 → 1 in order", () => {
    expect(
      isPlayableMotion({ type: "path", keyframes: [key(0), key(0.5)] })
    ).toBe(false);
    expect(
      isPlayableMotion({ type: "path", keyframes: [key(0.1), key(1)] })
    ).toBe(false);
    expect(
      isPlayableMotion({
        type: "path",
        keyframes: [key(0), key(0.6), key(0.4), key(1)]
      })
    ).toBe(false);
    expect(
      isPlayableMotion({
        type: "path",
        keyframes: [
          key(0),
          { t: 1, position: [0, 0], quaternion: [0, 0, 0, 1] }
        ]
      })
    ).toBe(false);
  });

  it("everything it accepts turns into keyframes", () => {
    const accepted: Motion[] = [
      { type: "linear", direction: [0, 0, 1], distance: 5 },
      { type: "L", segments: [] },
      {
        type: "helix",
        axis: [0, 0, 1],
        origin: [0, 0, 0],
        pitch: 1,
        turns: 2,
        approach: 3
      },
      {
        type: "path",
        keyframes: [
          { t: 0, position: [0, 0, 5], quaternion: [0, 0, 0, 1] },
          { t: 1, position: [0, 0, 0], quaternion: [0, 0, 0, 1] }
        ]
      },
      {
        type: "waypoints",
        waypoints: [
          { offset: [0, 0, 5], rotation: [0, 0, 0, 0] },
          { offset: [0, 0, 0], rotation: [0, 0, 0, 1] }
        ]
      }
    ];
    for (const motion of accepted) {
      expect(isPlayableMotion(motion)).toBe(true);
      const keyframes = motionToKeyframes(motion, IDENTITY_POSE);
      expect(keyframes?.times.every(Number.isFinite)).toBe(true);
      expect(keyframes?.positions.every(Number.isFinite)).toBe(true);
      expect(keyframes?.quaternions.every(Number.isFinite)).toBe(true);
    }
  });
});
