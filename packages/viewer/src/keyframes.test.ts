// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  type MotionKeyframes,
  motionToKeyframes,
  type Pose,
  resampleEased,
  waypointMatrix
} from "./keyframes";
import {
  expectMonotonicTimes,
  expectVectorClose,
  IDENTITY_POSE,
  lastIndex,
  positionAt,
  quaternionAt
} from "./test-utils";
import type { Motion, Vec3 } from "./types";

describe("motionToKeyframes", () => {
  it("returns null for none motions", () => {
    expect(motionToKeyframes({ type: "none" }, IDENTITY_POSE)).toBeNull();
  });

  it("linear: starts displaced against the insertion direction and ends at the final pose", () => {
    const basePose: Pose = {
      position: [10, 20, 30],
      quaternion: [0, 0, 0, 1]
    };
    const keyframes = motionToKeyframes(
      { type: "linear", direction: [0, 0, -1], distance: 80 },
      basePose,
      { duration: 2 }
    );
    expect(keyframes).not.toBeNull();
    if (!keyframes) return;

    expectMonotonicTimes(keyframes);
    expect(keyframes.times).toEqual([0, 2]);
    expectVectorClose(positionAt(keyframes, 0), [10, 20, 110]);
    expectVectorClose(
      positionAt(keyframes, lastIndex(keyframes)),
      [10, 20, 30]
    );
    expectVectorClose(quaternionAt(keyframes, 0), [0, 0, 0, 1]);
    expectVectorClose(
      quaternionAt(keyframes, lastIndex(keyframes)),
      [0, 0, 0, 1]
    );
  });

  it("linear: normalizes the direction vector", () => {
    const keyframes = motionToKeyframes(
      { type: "linear", direction: [0, 0, -10], distance: 80 },
      IDENTITY_POSE
    );
    if (!keyframes) throw new Error("expected keyframes");
    expectVectorClose(positionAt(keyframes, 0), [0, 0, 80]);
  });

  it("L: walks segments backwards from the final pose with proportional times", () => {
    const keyframes = motionToKeyframes(
      {
        type: "L",
        segments: [
          { direction: [1, 0, 0], distance: 60 },
          { direction: [0, 0, -1], distance: 20 }
        ]
      },
      IDENTITY_POSE,
      { duration: 2 }
    );
    if (!keyframes) throw new Error("expected keyframes");

    expectMonotonicTimes(keyframes);
    expect(keyframes.times.length).toBe(3);
    // 60 of 80 mm in segment 1 → 75% of the duration
    expect(keyframes.times[1]).toBeCloseTo(1.5);
    expect(keyframes.times[2]).toBeCloseTo(2);
    expectVectorClose(positionAt(keyframes, 0), [-60, 0, 20]);
    expectVectorClose(positionAt(keyframes, 1), [0, 0, 20]);
    expectVectorClose(positionAt(keyframes, 2), [0, 0, 0]);
  });

  it("helix: retracts by approach + pitch*turns and ends seated at the final pose", () => {
    const basePose: Pose = {
      position: [10, 20, 5],
      quaternion: [0, 0, 0, 1]
    };
    const motion: Motion = {
      type: "helix",
      axis: [0, 0, -1],
      origin: [10, 20, 5], // through the component center so rotation keeps position
      pitch: 0.8,
      turns: 6,
      approach: 30
    };
    const keyframes = motionToKeyframes(motion, basePose, {
      samplesPerTurn: 4
    });
    if (!keyframes) throw new Error("expected keyframes");

    expectMonotonicTimes(keyframes);
    // 1 approach start + 1 threading start + turns * samplesPerTurn samples
    expect(keyframes.times.length).toBe(2 + 6 * 4);
    expect(keyframes.quaternions.length).toBe((2 + 6 * 4) * 4);

    // Start fully retracted along the axis: approach + pitch*turns = 34.8 mm
    expectVectorClose(positionAt(keyframes, 0), [10, 20, 5 + 34.8]);
    // Threading start: approach consumed, thread advance remaining
    expectVectorClose(positionAt(keyframes, 1), [10, 20, 5 + 4.8]);
    // Seated
    const last = lastIndex(keyframes);
    expectVectorClose(positionAt(keyframes, last), [10, 20, 5]);
    expectVectorClose(quaternionAt(keyframes, last), [0, 0, 0, 1]);

    // Rotation actually happens between thread samples (quarter turns)
    const intermediate = quaternionAt(keyframes, 2);
    const final = quaternionAt(keyframes, last);
    const dot = intermediate.reduce(
      (sum, value, index) => sum + value * (final[index] ?? Number.NaN),
      0
    );
    expect(Math.abs(dot)).toBeLessThan(0.999);
  });

  it("helix: ends exactly at the final pose even when origin is off-axis from the component", () => {
    const basePose: Pose = {
      position: [10, 0, 0],
      quaternion: [0, 0, 0, 1]
    };
    const keyframes = motionToKeyframes(
      {
        type: "helix",
        axis: [0, 0, 1],
        origin: [0, 0, 0],
        pitch: 1,
        turns: 2.5,
        approach: 10
      },
      basePose
    );
    if (!keyframes) throw new Error("expected keyframes");
    const last = lastIndex(keyframes);
    expectVectorClose(positionAt(keyframes, last), [10, 0, 0]);
    expectVectorClose(quaternionAt(keyframes, last), [0, 0, 0, 1]);
    expectMonotonicTimes(keyframes);
  });

  it("path: passes absolute world poses through, scaling t by duration", () => {
    const keyframes = motionToKeyframes(
      {
        type: "path",
        keyframes: [
          { t: 0, position: [0, 0, 100], quaternion: [0, 0, 0, 1] },
          { t: 0.5, position: [0, 50, 50], quaternion: [0, 0, 0, 1] },
          { t: 1, position: [0, 0, 0], quaternion: [0, 0, 0, 1] }
        ]
      },
      IDENTITY_POSE,
      { duration: 2 }
    );
    if (!keyframes) throw new Error("expected keyframes");
    expect(keyframes.times).toEqual([0, 1, 2]);
    expectVectorClose(positionAt(keyframes, 0), [0, 0, 100]);
    expectVectorClose(positionAt(keyframes, 1), [0, 50, 50]);
    expectVectorClose(positionAt(keyframes, 2), [0, 0, 0]);
  });

  it("path: rejects non-monotonic times", () => {
    expect(() =>
      motionToKeyframes(
        {
          type: "path",
          keyframes: [
            { t: 0, position: [0, 0, 100], quaternion: [0, 0, 0, 1] },
            { t: 0.5, position: [0, 0, 50], quaternion: [0, 0, 0, 1] },
            { t: 0.5, position: [0, 0, 0], quaternion: [0, 0, 0, 1] }
          ]
        },
        IDENTITY_POSE
      )
    ).toThrow(/strictly increasing/);
  });

  it("path: rejects a last keyframe that is not the final pose", () => {
    expect(() =>
      motionToKeyframes(
        {
          type: "path",
          keyframes: [
            { t: 0, position: [0, 0, 100], quaternion: [0, 0, 0, 1] },
            { t: 1, position: [0, 0, 5], quaternion: [0, 0, 0, 1] }
          ]
        },
        IDENTITY_POSE
      )
    ).toThrow(/final pose/);
  });

  it("path: requires t to span 0..1 and at least 2 keyframes", () => {
    expect(() =>
      motionToKeyframes(
        {
          type: "path",
          keyframes: [{ t: 0, position: [0, 0, 0], quaternion: [0, 0, 0, 1] }]
        },
        IDENTITY_POSE
      )
    ).toThrow(/at least 2/);
    expect(() =>
      motionToKeyframes(
        {
          type: "path",
          keyframes: [
            { t: 0.1, position: [0, 0, 100], quaternion: [0, 0, 0, 1] },
            { t: 1, position: [0, 0, 0], quaternion: [0, 0, 0, 1] }
          ]
        },
        IDENTITY_POSE
      )
    ).toThrow(/span/);
  });
});

describe("resampleEased", () => {
  const straight: MotionKeyframes = {
    times: [0, 2],
    positions: [0, 0, 0, 0, 0, 100],
    quaternions: [0, 0, 0, 1, 0, 0, 0, 1]
  };

  it("preserves both endpoints and the total duration exactly", () => {
    const eased = resampleEased(straight);
    expectVectorClose(positionAt(eased, 0), [0, 0, 0]);
    expectVectorClose(positionAt(eased, lastIndex(eased)), [0, 0, 100]);
    expect(eased.times[0]).toBe(0);
    expect(eased.times[eased.times.length - 1]).toBeCloseTo(2);
    expectMonotonicTimes(eased);
  });

  it("accelerates off the start and decelerates into the seat", () => {
    const eased = resampleEased(straight);
    // 21 samples → index 5 is u=0.25 (time 0.5), index 15 is u=0.75 (time 1.5)
    expect(eased.times.length).toBe(21);
    const early = positionAt(eased, 5)[2] ?? Number.NaN;
    const late = positionAt(eased, 15)[2] ?? Number.NaN;
    // slow start: quarter of the way in time, far less than a quarter of the way
    expect(early).toBeLessThan(10); // easeInOutCubic(0.25)=0.0625 → ~6.25
    // gentle settle: three quarters through time, most of the distance covered
    expect(late).toBeGreaterThan(90); // easeInOutCubic(0.75)=0.9375 → ~93.75
    // symmetric ease keeps the midpoint at the midpoint
    expect(positionAt(eased, 10)[2] ?? Number.NaN).toBeCloseTo(50);
  });

  it("leaves a degenerate path unchanged", () => {
    const single: MotionKeyframes = {
      times: [0],
      positions: [1, 2, 3],
      quaternions: [0, 0, 0, 1]
    };
    expect(resampleEased(single)).toBe(single);
    const zero: MotionKeyframes = {
      times: [0, 0],
      positions: [0, 0, 0, 0, 0, 0],
      quaternions: [0, 0, 0, 1, 0, 0, 0, 1]
    };
    expect(resampleEased(zero)).toBe(zero);
  });
});

describe("waypoints motion", () => {
  const halfTurnZ: [number, number, number, number] = [0, 0, 1, 0];

  it("turns the set about its pivot, then shifts it, and ends seated", () => {
    const motion: Motion = {
      type: "waypoints",
      waypoints: [
        { offset: [0, 0, 50], rotation: halfTurnZ },
        { offset: [0, 0, 0], rotation: [0, 0, 0, 1] }
      ]
    };
    // Part sits 10 mm along +X from the set's center at the origin.
    const keyframes = motionToKeyframes(
      motion,
      { position: [10, 0, 0], quaternion: [0, 0, 0, 1] },
      { duration: 2, pivot: [0, 0, 0] }
    );
    if (!keyframes) throw new Error("expected keyframes");
    // 180° about Z swings the part to -X, then the offset lifts it.
    expectVectorClose(positionAt(keyframes, 0), [-10, 0, 50]);
    expectVectorClose(quaternionAt(keyframes, 0), [0, 0, 1, 0]);
    const last = lastIndex(keyframes);
    expectVectorClose(positionAt(keyframes, last), [10, 0, 0]);
    expectVectorClose(quaternionAt(keyframes, last), [0, 0, 0, 1]);
    expect(keyframes.times[last]).toBeCloseTo(2);
  });

  it("waypointMatrix turns about the pivot, then shifts", () => {
    const turn = new Quaternion(...halfTurnZ);
    const offset = new Vector3(0, 0, 50);
    const point = (pivot: Vec3) =>
      new Vector3(10, 0, 0)
        .applyMatrix4(waypointMatrix(offset, turn, new Vector3(...pivot)))
        .toArray();
    expectVectorClose(point([0, 0, 0]), [-10, 0, 50]);
    expectVectorClose(point([5, 0, 0]), [0, 0, 50]);
  });

  it("swings a part round the pivot through a turn, never across it", () => {
    const halfTurnInPlace: Motion = {
      type: "waypoints",
      waypoints: [
        { offset: [0, 0, 0], rotation: halfTurnZ },
        { offset: [0, 0, 0], rotation: [0, 0, 0, 1] }
      ]
    };
    const keyframes = motionToKeyframes(
      halfTurnInPlace,
      { position: [10, 0, 0], quaternion: [0, 0, 0, 1] },
      { duration: 2, pivot: [0, 0, 0] }
    );
    if (!keyframes) throw new Error("expected keyframes");
    // The track moves in a straight line between keyframes: each midpoint
    // must stay near the 10 mm arc (two keyframes alone would pass through
    // the pivot at mid-turn).
    for (let i = 0; i < lastIndex(keyframes); i++) {
      const [ax = 0, ay = 0, az = 0] = positionAt(keyframes, i);
      const [bx = 0, by = 0, bz = 0] = positionAt(keyframes, i + 1);
      const radius = Math.hypot((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
      expect(radius).toBeGreaterThan(9.5);
    }
  });
});
