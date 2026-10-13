// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { displayMotionForStep, naturalizeMotion } from "./display";
import { indexAssemblyGraph } from "./graph";
import type { AssemblyStep, Motion } from "./types";

describe("naturalizeMotion", () => {
  const lift = {
    type: "linear",
    direction: [0, 0, -1] as [number, number, number],
    distance: 15
  } as const;

  it("floors small-component travel to a readable distance", () => {
    // 20mm bolt in a 1000mm assembly travels at least 2.5x its size
    const result = naturalizeMotion(lift, 20, 1000);
    expect(result.type).toBe("linear");
    if (result.type === "linear") {
      expect(result.distance).toBe(50);
    }
  });

  it("caps a long travel to a few of the part's own body-lengths", () => {
    // 20mm part flying in 500mm → ceiling 3*20 + 5 = 65
    const long = { ...lift, distance: 500 };
    const result = naturalizeMotion(long, 20, 1000);
    if (result.type === "linear") {
      expect(result.distance).toBe(65);
    } else {
      throw new Error("expected linear motion");
    }
  });

  it("caps a large part at the assembly-wide ceiling, not the raw travel", () => {
    // 400mm part (not small), 2000mm travel. Per-part ceiling is 3*400+5=1205,
    // but the assembly cap 0.35*1000=350 governs — nothing flies in from
    // further than a third of the whole assembly, however large the part.
    const long = { ...lift, distance: 2000 };
    const result = naturalizeMotion(long, 400, 1000);
    if (result.type === "linear") {
      expect(result.distance).toBe(350);
    } else {
      throw new Error("expected linear motion");
    }
  });

  it("keeps a large flat part's drop within the assembly (seal fly-out)", () => {
    // 166mm diagonal, 288mm L-travel, 196mm assembly: the per-part ceiling
    // alone (3*166+5=503) would let it fly in from 1.5x the whole assembly.
    const seal: Motion = {
      type: "L",
      segments: [
        { direction: [1, 0, 0], distance: 122 },
        { direction: [0, 0, -1], distance: 166 }
      ]
    };
    const result = naturalizeMotion(seal, 166, 196);
    if (result.type !== "L") throw new Error("expected L motion");
    const total = result.segments.reduce(
      (sum, s) => sum + Math.abs(s.distance),
      0
    );
    expect(total).toBeCloseTo(196 * 0.35, 1); // ~68.6mm, a natural drop
  });

  it("leaves an in-band travel unchanged", () => {
    const inBand = { ...lift, distance: 55 }; // within [50, 65] for a 20mm part
    expect(naturalizeMotion(inBand, 20, 1000)).toBe(inBand);
  });

  it("floors then scales L segments proportionally", () => {
    const motion: Motion = {
      type: "L",
      segments: [
        { direction: [1, 0, 0], distance: 6 },
        { direction: [0, 0, -1], distance: 4 }
      ]
    };
    const result = naturalizeMotion(motion, 20, 1000); // total 10 → floor 50
    if (result.type === "L") {
      const total = result.segments.reduce((sum, s) => sum + s.distance, 0);
      expect(total).toBeCloseTo(50);
      expect(
        result.segments[0]!.distance / result.segments[1]!.distance
      ).toBeCloseTo(6 / 4);
    } else {
      throw new Error("expected L motion");
    }
  });

  it("caps an over-long L total to the ceiling", () => {
    const motion: Motion = {
      type: "L",
      segments: [
        { direction: [1, 0, 0], distance: 180 },
        { direction: [0, 0, -1], distance: 120 }
      ]
    };
    const result = naturalizeMotion(motion, 20, 1000); // total 300 → ceiling 65
    if (result.type === "L") {
      const total = result.segments.reduce((sum, s) => sum + s.distance, 0);
      expect(total).toBeCloseTo(65);
      expect(
        result.segments[0]!.distance / result.segments[1]!.distance
      ).toBeCloseTo(180 / 120);
    } else {
      throw new Error("expected L motion");
    }
  });

  it("does not touch none motions", () => {
    const none = { type: "none" } as const;
    expect(naturalizeMotion(none, 20, 1000)).toBe(none);
  });
});

describe("displayMotionForStep", () => {
  const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const graphIndex = indexAssemblyGraph({
    version: 1,
    unit: "mm",
    sourceUnit: "mm",
    componentCount: 2,
    root: {
      nodeId: "root",
      name: "Assembly",
      isAssembly: true,
      geometryHash: null,
      transform: IDENTITY,
      bbox: { min: [-50, -50, 0], max: [50, 50, 20] },
      volume: null,
      color: null,
      children: [
        {
          nodeId: "base",
          name: "base",
          isAssembly: false,
          geometryHash: "hash-base",
          transform: IDENTITY,
          bbox: { min: [-50, -50, 0], max: [50, 50, 10] },
          volume: 1000,
          color: null,
          children: []
        },
        {
          nodeId: "top",
          name: "top",
          isAssembly: false,
          geometryHash: "hash-top",
          transform: IDENTITY,
          bbox: { min: [-10, -10, 10], max: [10, 10, 20] },
          volume: 1000,
          color: null,
          children: []
        }
      ]
    }
  });

  const step = (
    overrides: Partial<
      Pick<AssemblyStep, "motion" | "componentNodeIds" | "flagged">
    >
  ) => ({
    motion: { type: "none" } as Motion,
    componentNodeIds: ["top"],
    ...overrides
  });

  const present = new Set(["base"]);

  it("keeps motion none for flagged steps — no fabricated fallback", () => {
    expect(
      displayMotionForStep(step({ flagged: true }), 1, graphIndex, present)
    ).toEqual({ type: "none" });
  });

  it("synthesizes a fallback for unflagged none-motion steps after the base", () => {
    const motion = displayMotionForStep(step({}), 1, graphIndex, present);
    expect(motion.type).toBe("linear");
  });

  it("keeps the base step still", () => {
    expect(displayMotionForStep(step({}), 0, graphIndex, present)).toEqual({
      type: "none"
    });
  });

  it("passes stored motions through untouched", () => {
    const stored: Motion = {
      type: "linear",
      direction: [0, 0, -1],
      distance: 5
    };
    expect(
      displayMotionForStep(step({ motion: stored }), 1, graphIndex, present)
    ).toBe(stored);
  });

  it("only treats present components as obstacles", () => {
    // A canopy leaf over "top" that is NOT in the present set must not
    // redirect the fallback.
    const canopyIndex = indexAssemblyGraph({
      ...graphIndex.graph,
      root: {
        ...graphIndex.graph.root,
        children: [
          ...graphIndex.graph.root.children,
          {
            nodeId: "canopy",
            name: "canopy",
            isAssembly: false,
            geometryHash: "hash-canopy",
            transform: IDENTITY,
            bbox: { min: [-50, -50, 30], max: [50, 50, 40] },
            volume: 1000,
            color: null,
            children: []
          }
        ]
      }
    });
    const motion = displayMotionForStep(step({}), 1, canopyIndex, present);
    // Insertion still approaches from above: the absent canopy doesn't block
    if (motion.type !== "linear") throw new Error("expected linear");
    expect(motion.direction[2]).toBe(-1);
  });
});
