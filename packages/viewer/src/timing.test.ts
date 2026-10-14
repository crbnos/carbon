// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  fadeProgress,
  motionDuration,
  motionTravelDistance,
  stepClipTiming
} from "./timing";
import type { Motion } from "./types";

describe("motionTravelDistance", () => {
  it("computes travel for each motion type", () => {
    expect(
      motionTravelDistance({
        type: "linear",
        direction: [0, 0, -1],
        distance: 80
      })
    ).toBe(80);
    expect(
      motionTravelDistance({
        type: "L",
        segments: [
          { direction: [1, 0, 0], distance: 60 },
          { direction: [0, 0, -1], distance: 20 }
        ]
      })
    ).toBe(80);
    expect(
      motionTravelDistance({
        type: "helix",
        axis: [0, 0, -1],
        origin: [0, 0, 0],
        pitch: 0.8,
        turns: 6,
        approach: 30
      })
    ).toBeCloseTo(34.8);
    expect(motionTravelDistance({ type: "none" })).toBe(0);
  });
});

describe("motionDuration", () => {
  it("scales with travel distance and clamps to 1-4 s", () => {
    expect(
      motionDuration({ type: "linear", direction: [0, 0, 1], distance: 6 })
    ).toBe(1);
    expect(
      motionDuration({ type: "linear", direction: [0, 0, 1], distance: 120 })
    ).toBeCloseTo(2);
    expect(
      motionDuration({ type: "linear", direction: [0, 0, 1], distance: 6000 })
    ).toBe(4);
    expect(motionDuration({ type: "none" })).toBe(0);
  });
});

describe("stepClipTiming", () => {
  const linear: Motion = { type: "linear", direction: [0, 0, 1], distance: 60 };
  const seconds = motionDuration(linear);

  it("plays the natural animation when no duration is authored", () => {
    expect(stepClipTiming({ motion: linear })).toEqual({
      total: seconds + 0.6,
      units: [],
      unitsTotal: 0,
      glide: 0,
      motion: seconds,
      hold: 0.6
    });
  });

  it("adds a carry-in glide before the insertion", () => {
    const timing = stepClipTiming({ motion: linear }, { glideSeconds: 1.2 });
    expect(timing.total).toBeCloseTo(1.2 + seconds + 0.6);
    expect(timing.glide).toBe(1.2);
  });

  it("gives a process-only step a fixed slot plus any glide", () => {
    expect(stepClipTiming({ motion: { type: "none" } }).total).toBe(2);
    expect(
      stepClipTiming({ motion: { type: "none" } }, { glideSeconds: 1.2 }).total
    ).toBe(3.2);
  });

  it("gives a step that only brings a unit in its units and the hold", () => {
    const unit: Motion = {
      type: "linear",
      direction: [0, 0, -1],
      distance: 60
    };
    // An unused header joining on its own path: nothing of its own moves or fades.
    const header = stepClipTiming(
      { motion: { type: "none" } },
      { units: [unit], ownParts: false }
    );
    expect(header.total).toBeCloseTo(motionDuration(unit) + 0.6);
    expect(header.hold).toBeCloseTo(0.6);
    // A stored motion with nothing of its own to move adds no time.
    expect(
      stepClipTiming({ motion: linear }, { units: [unit], ownParts: false })
        .total
    ).toBeCloseTo(motionDuration(unit) + 0.6);
    // Own parts that fade in after the unit keep the fixed slot.
    expect(
      stepClipTiming({ motion: { type: "none" } }, { units: [unit] }).total
    ).toBeCloseTo(motionDuration(unit) + 2);
    // Nothing to bring in and nothing to move: a process-only step.
    expect(
      stepClipTiming({ motion: { type: "none" } }, { ownParts: false }).total
    ).toBe(2);
  });

  it("speeds glide, insertion and hold up to fit a shorter authored duration", () => {
    const natural = 1.2 + seconds + 0.6;
    const timing = stepClipTiming(
      { motion: linear, durationSeconds: natural / 2 },
      { glideSeconds: 1.2 }
    );
    expect(timing.total).toBe(natural / 2);
    expect(timing.glide + timing.motion + timing.hold).toBeCloseTo(natural / 2);
    expect(timing.glide).toBeCloseTo(0.6);
  });

  it("keeps the natural animation inside a longer authored duration", () => {
    const timing = stepClipTiming({ motion: linear, durationSeconds: 30 });
    expect(timing.total).toBe(30);
    expect(timing.motion).toBe(seconds);
  });

  it("times each unit by its own path and scales it with an authored duration", () => {
    // 120 mm at 60 mm/s: a 2 s path.
    const unit: Motion = {
      type: "linear",
      direction: [0, 0, -1],
      distance: 120
    };
    const drop: Motion = {
      type: "linear",
      direction: [0, 0, -1],
      distance: 10
    };
    const natural = stepClipTiming({ motion: drop }, { units: [unit] });
    expect(natural.units).toEqual([2]);
    expect(natural.unitsTotal).toBe(2);
    const fitted = stepClipTiming(
      { motion: drop, durationSeconds: natural.total / 2 },
      { units: [unit] }
    );
    expect(fitted.units[0]).toBeCloseTo(1);
    expect(fitted.unitsTotal).toBeCloseTo(1);
    expect(fitted.total).toBeCloseTo(natural.total / 2);
  });
});

describe("fadeProgress", () => {
  it("waits for the units, then fades in over its own time", () => {
    expect(fadeProgress(0.5, 2, 1.2, false)).toBe(0);
    expect(fadeProgress(2, 2, 1.2, false)).toBe(0);
    expect(fadeProgress(2.6, 2, 1.2, false)).toBeCloseTo(0.5);
    expect(fadeProgress(5, 2, 1.2, false)).toBe(1);
  });

  it("is fully in once the step has finished, whatever the clock says", () => {
    expect(fadeProgress(0, 2, 1.2, true)).toBe(1);
  });

  it("starts at once with no units", () => {
    expect(fadeProgress(0.6, 0, 1.2, false)).toBeCloseTo(0.5);
  });
});

describe("waypoints motion timing", () => {
  const halfTurnZ: [number, number, number, number] = [0, 0, 1, 0];

  it("gives a turn in place readable time", () => {
    const halfTurnInPlace: Motion = {
      type: "waypoints",
      waypoints: [
        { offset: [0, 0, 0], rotation: halfTurnZ },
        { offset: [0, 0, 0], rotation: [0, 0, 0, 1] }
      ]
    };
    // 30 mm of travel per radian turned, played at 60 mm/s: π/2 s, above the
    // 1 s floor a turn counted as no travel would get.
    expect(motionTravelDistance(halfTurnInPlace)).toBeCloseTo(Math.PI * 30);
    expect(motionDuration(halfTurnInPlace)).toBeCloseTo(Math.PI / 2);
  });
});
