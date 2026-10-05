// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { DURATION, PRESS_EDGE_SHIFT, pressScale, SPRING } from "./motion";

describe("pressScale", () => {
  it("moves every control's EDGE the same distance, whatever its size", () => {
    // The whole point: a fixed scale factor makes a big card lurch while a
    // small button barely moves. Here the edge travel is constant instead.
    for (const size of [48, 120, 320]) {
      const travelled = (size - pressScale(size) * size) / 2;
      expect(travelled).toBeCloseTo(PRESS_EDGE_SHIFT, 5);
    }
  });

  it("shrinks, never grows", () => {
    for (const size of [48, 120, 320]) {
      expect(pressScale(size)).toBeLessThan(1);
      expect(pressScale(size)).toBeGreaterThan(0.9);
    }
  });

  it("floors at 0.9, so a tiny control is not crushed", () => {
    // A 20pt control losing 3pt would be 0.85 and read as a collapse.
    expect(pressScale(20)).toBe(0.9);
  });

  it("is a no-op for a size it cannot use, rather than NaN", () => {
    // A control measures 0 on its first layout pass; scaling by NaN there
    // blanks it.
    expect(pressScale(0)).toBe(1);
    expect(pressScale(-5)).toBe(1);
    expect(pressScale(Number.NaN)).toBe(1);
  });
});

describe("DURATION", () => {
  it("is ordered, so the names mean what they say", () => {
    expect(DURATION.instant).toBeLessThan(DURATION.quick);
    expect(DURATION.quick).toBeLessThan(DURATION.settle);
    expect(DURATION.settle).toBeLessThan(DURATION.slow);
  });

  it("keeps every duration short enough for a shop floor", () => {
    // An operator taps these hundreds of times a shift. Charming once is a
    // tax by the fiftieth.
    for (const ms of Object.values(DURATION))
      expect(ms).toBeLessThanOrEqual(320);
  });
});

describe("SPRING", () => {
  // A spring overshoots when it is under-damped: damping < 2*sqrt(stiffness*mass).
  const overshoots = (s: {
    damping: number;
    stiffness: number;
    mass: number;
  }) => s.damping < 2 * Math.sqrt(s.stiffness * s.mass);

  it("only `bouncy` overshoots", () => {
    expect(overshoots(SPRING.bouncy)).toBe(true);
    expect(overshoots(SPRING.gentle)).toBe(false);
    expect(overshoots(SPRING.snappy)).toBe(false);
  });

  it("makes `snappy` stiffer than `gentle`, as the names promise", () => {
    expect(SPRING.snappy.stiffness).toBeGreaterThan(SPRING.gentle.stiffness);
  });
});
