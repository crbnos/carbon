// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  addDragSample,
  type DragSample,
  releaseVelocity,
  rubberBand,
  shouldDismissSheet
} from "./drag";

function drag(points: [y: number, t: number][]): DragSample[] {
  return points.reduce<DragSample[]>(
    (samples, [y, t]) => addDragSample(samples, { y, t }),
    []
  );
}

describe("releaseVelocity", () => {
  it("reads a flick from the moves, whatever the pointerup reports", () => {
    const samples = drag([
      [0, 0],
      [30, 16],
      [60, 32],
      [90, 48]
    ]);
    expect(releaseVelocity(samples, 48)).toBeCloseTo(1.875);
  });

  it("is 0 when the finger rested before lifting", () => {
    const samples = drag([
      [0, 0],
      [200, 40]
    ]);
    expect(releaseVelocity(samples, 300)).toBe(0);
  });

  it("forgets a fast start the finger has since slowed from", () => {
    const samples = drag([
      [0, 0],
      [300, 50],
      [301, 200],
      [302, 250]
    ]);
    expect(releaseVelocity(samples, 250)).toBeCloseTo(0.02);
  });

  it("is negative for a flick back up", () => {
    const samples = drag([
      [200, 0],
      [100, 50]
    ]);
    expect(releaseVelocity(samples, 50)).toBe(-2);
  });

  it("is 0 for a press that never moved", () => {
    expect(releaseVelocity(drag([[40, 10]]), 90)).toBe(0);
    expect(releaseVelocity([], 90)).toBe(0);
  });

  it("is 0 when two samples share a timestamp", () => {
    const samples = drag([
      [0, 10],
      [50, 10]
    ]);
    expect(releaseVelocity(samples, 10)).toBe(0);
  });
});

describe("rubberBand", () => {
  it("does not move at the edge", () => {
    expect(rubberBand(0, 32)).toBe(0);
  });

  it("gives 1px for every 5 at first", () => {
    expect(rubberBand(1, 1000)).toBeCloseTo(0.2, 2);
  });

  it("grows with the drag but never reaches its limit", () => {
    expect(rubberBand(200, 32)).toBeGreaterThan(rubberBand(100, 32));
    expect(rubberBand(100_000, 32)).toBeLessThan(32);
  });
});

describe("shouldDismissSheet", () => {
  it("closes when dragged past a third of the sheet", () => {
    expect(shouldDismissSheet({ offset: 240, height: 700, velocity: 0 })).toBe(
      true
    );
  });

  it("closes on a short, fast flick", () => {
    expect(shouldDismissSheet({ offset: 60, height: 700, velocity: 1 })).toBe(
      true
    );
  });

  it("stays open for a few pixels of fast jitter", () => {
    expect(shouldDismissSheet({ offset: 3, height: 700, velocity: 1.5 })).toBe(
      false
    );
  });

  it("stays open after a slow, short drag", () => {
    expect(
      shouldDismissSheet({ offset: 100, height: 700, velocity: 0.1 })
    ).toBe(false);
  });
});
