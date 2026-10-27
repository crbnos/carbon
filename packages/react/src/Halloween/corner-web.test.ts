// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { BAR_HEIGHT, createCornerWeb } from "./corner-web";
import { seeded } from "./math";

// The corner cobwebs sit over the top bar all day. They must stay in their
// corner, keep inside the bar, sway when brushed and settle again.

const WIDTH = 1200;

function settle(web: ReturnType<typeof createCornerWeb>, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 120) web.step(1 / 120);
}

describe("createCornerWeb", () => {
  it.each(["left", "right"] as const)(
    "the %s web fans out from its own corner and stays inside the bar",
    (side) => {
      const web = createCornerWeb(side, WIDTH);
      const corner = side === "left" ? 0 : WIDTH;
      for (const { x, y } of web.knots()) {
        expect(Math.abs(x - corner)).toBeLessThan(40);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(BAR_HEIGHT);
      }
      expect(web.paths().spokes.startsWith(`M ${corner} 0`)).toBe(true);
    }
  );

  it("is still until something touches it", () => {
    const web = createCornerWeb("left", WIDTH);
    settle(web, 1);
    expect(web.restlessness()).toBeLessThan(1);
  });

  it("sways when brushed, then settles back into shape", () => {
    const web = createCornerWeb("left", WIDTH);
    const before = web.hub();
    expect(web.brush(before.x, before.y, 900, 400)).toBe(true);
    settle(web, 0.05);
    expect(web.restlessness()).toBeGreaterThan(1);
    settle(web, 6);
    expect(web.restlessness()).toBeLessThan(1);
    const after = web.hub();
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1);
  });

  it("a brush far from the threads leaves it alone", () => {
    const web = createCornerWeb("left", WIDTH);
    expect(web.brush(600, 20, 900, 400)).toBe(false);
  });

  it("bursts on a snap and is whole again after a reset", () => {
    const web = createCornerWeb("right", WIDTH);
    const rest = web.paths();
    web.burst(seeded(1));
    settle(web, 0.1);
    expect(web.paths().rings).not.toBe(rest.rings);
    web.reset();
    expect(web.paths()).toEqual(rest);
    expect(web.restlessness()).toBe(0);
  });
});
