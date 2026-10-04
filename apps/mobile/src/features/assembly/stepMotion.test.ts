// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Motion } from "@carbon/viewer/types";
import { describe, expect, it } from "vitest";
import {
  easeInOut,
  expandToLeaves,
  motionDurationMs,
  motionOffsetAt,
  motionSpinAt,
  motionTravel
} from "./stepMotion";

const near = (v: readonly number[], expected: number[]) => {
  expect(v.length).toBe(3);
  for (const [i, n] of v.entries()) {
    expect(n).toBeCloseTo(expected[i] as number, 5);
  }
};

const linear: Motion = { type: "linear", direction: [0, 1, 0], distance: 100 };
const lShaped: Motion = {
  type: "L",
  segments: [
    { direction: [1, 0, 0], distance: 60 },
    { direction: [0, -1, 0], distance: 40 }
  ]
};

describe("motionOffsetAt", () => {
  it("is zero at the seated end, so the last frame restores the model", () => {
    near(motionOffsetAt(linear, 1), [0, 0, 0]);
  });

  it("starts the full travel BACK along the direction it seats in", () => {
    near(motionOffsetAt(linear, 0), [0, -100, 0]);
  });

  it("is proportional part-way through", () => {
    near(motionOffsetAt(linear, 0.25), [0, -75, 0]);
  });

  it("normalizes a direction that is not a unit vector", () => {
    const motion: Motion = {
      type: "linear",
      direction: [0, 3, 0],
      distance: 10
    };
    near(motionOffsetAt(motion, 0), [0, -10, 0]);
  });

  it("treats a zero direction as no motion rather than producing NaN", () => {
    const motion: Motion = {
      type: "linear",
      direction: [0, 0, 0],
      distance: 10
    };
    near(motionOffsetAt(motion, 0), [0, 0, 0]);
  });

  it("clamps t outside 0..1", () => {
    near(motionOffsetAt(linear, 5), [0, 0, 0]);
    near(motionOffsetAt(linear, -5), [0, -100, 0]);
  });

  it("undoes an L motion's segments in reverse, last segment first", () => {
    // Total 100. Backing out 40 undoes only the final segment.
    near(motionOffsetAt(lShaped, 0.6), [0, 40, 0]);
  });

  it("walks into the earlier segment once the later one is undone", () => {
    // Backing out 70 undoes all 40 of the second, then 30 of the first.
    near(motionOffsetAt(lShaped, 0.3), [-30, 40, 0]);
  });

  it("is the whole L path at the start", () => {
    near(motionOffsetAt(lShaped, 0), [-60, 40, 0]);
  });

  it("uses only the approach of a helix, never a wrong rotation", () => {
    const helix: Motion = {
      type: "helix",
      axis: [0, 0, 1],
      origin: [0, 0, 0],
      pitch: 2,
      turns: 5,
      approach: 10
    };
    near(motionOffsetAt(helix, 0), [0, 0, -20]);
  });

  it("does not move a none step", () => {
    near(motionOffsetAt({ type: "none" }, 0), [0, 0, 0]);
  });

  it("does not move a path step, rather than moving it wrongly", () => {
    const path: Motion = {
      type: "path",
      keyframes: [
        { t: 0, position: [0, 50, 0], quaternion: [0, 0, 0, 1] },
        { t: 1, position: [0, 0, 0], quaternion: [0, 0, 0, 1] }
      ]
    };
    near(motionOffsetAt(path, 0), [0, 0, 0]);
  });

  it("does not move when there is no motion at all", () => {
    near(motionOffsetAt(null, 0), [0, 0, 0]);
  });
});

describe("motionTravel", () => {
  it("sums an L motion's segments", () => {
    expect(motionTravel(lShaped)).toBe(100);
  });

  it("counts a helix's approach and its thread", () => {
    expect(
      motionTravel({
        type: "helix",
        axis: [0, 0, 1],
        origin: [0, 0, 0],
        pitch: 2,
        turns: 5,
        approach: 10
      })
    ).toBe(20);
  });

  it("is zero for none", () => {
    expect(motionTravel({ type: "none" })).toBe(0);
  });
});

describe("motionDurationMs", () => {
  it("is zero for a step that does not move, so nothing is scheduled", () => {
    expect(motionDurationMs({ type: "none" })).toBe(0);
  });

  it("gives a longer part a longer insertion", () => {
    const short = motionDurationMs({
      type: "linear",
      direction: [0, 1, 0],
      distance: 120
    });
    const long = motionDurationMs({
      type: "linear",
      direction: [0, 1, 0],
      distance: 400
    });
    expect(long).toBeGreaterThan(short);
  });

  it("is bounded so a huge travel cannot stall the operator", () => {
    expect(
      motionDurationMs({
        type: "linear",
        direction: [0, 1, 0],
        distance: 1_000_000
      })
    ).toBeLessThanOrEqual(2000);
  });

  it("is never so short it reads as a pop", () => {
    expect(
      motionDurationMs({ type: "linear", direction: [0, 1, 0], distance: 1 })
    ).toBeGreaterThanOrEqual(350);
  });
});

describe("easeInOut", () => {
  it("pins both ends", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
  });

  it("is symmetric about the midpoint", () => {
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 5);
    expect(easeInOut(0.25) + easeInOut(0.75)).toBeCloseTo(1, 5);
  });

  it("clamps outside 0..1", () => {
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(9)).toBe(1);
  });
});

describe("expandToLeaves", () => {
  const subtrees = new Map([
    ["piston-asm", ["piston-asm", "crown", "pin"]],
    ["bolt", ["bolt"]]
  ]);
  const leaves = new Set(["crown", "pin", "bolt"]);

  it("replaces an assembly node with the leaves beneath it", () => {
    // Without this the fallback synthesis sees no component at all and
    // silently returns no motion.
    expect(expandToLeaves(["piston-asm"], subtrees, leaves)).toEqual(
      new Set(["crown", "pin"])
    );
  });

  it("keeps a leaf as itself", () => {
    expect(expandToLeaves(["bolt"], subtrees, leaves)).toEqual(
      new Set(["bolt"])
    );
  });

  it("drops an id the graph does not know", () => {
    expect(expandToLeaves(["ghost"], subtrees, leaves)).toEqual(new Set());
  });
});

describe("motionSpinAt", () => {
  const helix: Motion = {
    type: "helix",
    axis: [0, 0, 1],
    origin: [1, 2, 3],
    pitch: 2,
    turns: 3,
    approach: 10
  };

  it("has nothing left to turn once seated", () => {
    expect(motionSpinAt(helix, 1)?.radians).toBeCloseTo(0, 10);
  });

  it("unwinds every turn at the start of the approach", () => {
    expect(motionSpinAt(helix, 0)?.radians).toBeCloseTo(-3 * 2 * Math.PI, 5);
  });

  it("carries the axis and the origin it turns about", () => {
    const spin = motionSpinAt(helix, 0);
    expect(spin?.axis).toEqual([0, 0, 1]);
    expect(spin?.origin).toEqual([1, 2, 3]);
  });

  it("is null for a motion that does not thread", () => {
    expect(motionSpinAt(linear, 0)).toBeNull();
    expect(motionSpinAt({ type: "none" }, 0)).toBeNull();
    expect(motionSpinAt(null, 0)).toBeNull();
  });
});
