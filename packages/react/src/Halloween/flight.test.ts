// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The bats' paths must start and end off screen, never fly in step, and grow
// as they come at the viewer.

import { describe, expect, it } from "vitest";
import { approach, crossing, takeOff } from "./flight";
import { seeded } from "./math";

const WIDTH = 1440;
const HEIGHT = 900;

describe("crossing", () => {
  it("starts and ends off screen, on opposite sides", () => {
    const right = crossing(WIDTH, HEIGHT, true, seeded(3));
    expect(right.x[0]).toBeLessThan(0);
    expect(right.x.at(-1)).toBeGreaterThan(WIDTH);
    const left = crossing(WIDTH, HEIGHT, false, seeded(3));
    expect(left.x[0]).toBeGreaterThan(WIDTH);
    expect(left.x.at(-1)).toBeLessThan(0);
  });

  it("stays in the upper half and keeps a sane depth and bank", () => {
    const flight = crossing(WIDTH, HEIGHT, true, seeded(11));
    for (const y of flight.y) {
      expect(y).toBeGreaterThanOrEqual(HEIGHT * 0.05);
      expect(y).toBeLessThanOrEqual(HEIGHT * 0.5);
    }
    for (const scale of flight.scale) {
      expect(scale).toBeGreaterThanOrEqual(0.5);
      expect(scale).toBeLessThanOrEqual(1.5);
    }
    for (const angle of flight.rotate)
      expect(Math.abs(angle)).toBeLessThanOrEqual(32);
  });

  it("gives two bats of one group different paths", () => {
    const random = seeded(5);
    const first = crossing(WIDTH, HEIGHT, true, random);
    const second = crossing(WIDTH, HEIGHT, true, random);
    expect(first.y).not.toEqual(second.y);
  });
});

describe("approach", () => {
  it("grows from far away to past the viewer and exits off screen", () => {
    const flight = approach(WIDTH, HEIGHT, seeded(7));
    expect(flight.scale[0]).toBeLessThan(0.2);
    expect(flight.scale.at(-1)).toBeGreaterThan(3);
    const exitX = flight.x.at(-1) ?? 0;
    expect(exitX < 0 || exitX > WIDTH).toBe(true);
    expect(flight.opacity[0]).toBe(0);
  });
});

describe("takeOff", () => {
  it("rises from the toast, fading in and out", () => {
    const flight = takeOff(seeded(9));
    expect(flight.x[0]).toBe(0);
    expect(flight.y.at(-1)).toBeLessThan(-100);
    expect(flight.opacity[0]).toBe(0);
    expect(flight.opacity.at(-1)).toBe(0);
  });
});
