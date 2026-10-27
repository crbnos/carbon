// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { createRig, LEGS, SPIDER_SCALE, solveKnee } from "./spider-rig";

// The page: a foot holds wherever it lands.
const DT = 1 / 120;

function groupOf(leg: number) {
  const spec = LEGS[leg];
  if (!spec) throw new Error(`no leg ${leg}`);
  return spec.group;
}

describe("solveKnee", () => {
  it("reaches the foot, with the knee along the leg and leaning out", () => {
    const hip = { x: 0, y: 0 };
    const foot = { x: 18, y: 4 };
    const outward = { x: 0, y: -1 };
    const { knee, end } = solveKnee(hip, foot, 11, 14, outward);
    expect(end.x).toBeCloseTo(18);
    expect(end.y).toBeCloseTo(4);
    // Between hip and foot, not stuck out to the side like an elbow...
    expect(knee.x).toBeGreaterThan(0);
    expect(knee.x).toBeLessThan(18);
    // ...and on the outward side of the line from hip to foot.
    const side = (knee.x * 4 - knee.y * 18) / Math.hypot(18, 4);
    expect(side).toBeGreaterThan(0);
  });

  it("stretches straight towards a foot out of reach", () => {
    const { end } = solveKnee({ x: 0, y: 0 }, { x: 100, y: 0 }, 11, 14, {
      x: 0,
      y: 1
    });
    expect(end.x).toBeCloseTo(25, 1);
    expect(end.y).toBeCloseTo(0);
  });
});

describe("createRig", () => {
  it("keeps every foot planted while the body holds still", () => {
    const rig = createRig();
    const body = { x: 100, y: 100, angle: 0 };
    rig.place(body);
    const placed = rig.feet();
    for (let i = 0; i < 240; i++) {
      rig.update(DT, body, { x: 0, y: 0 }, "walk");
    }
    expect(rig.stepping()).toBe(false);
    expect(rig.feet()).toEqual(placed);
  });

  it("walks with an alternating gait: four feet down, the groups taking turns", () => {
    const rig = createRig();
    const body = { x: 0, y: 0, angle: 0 };
    rig.place(body);
    // An unhurried walk: about four body lengths a second.
    const speed = 60 * SPIDER_SCALE;
    const steps = { 0: 0, 1: 0 };
    let wasUp = new Set<number>();
    for (let i = 0; i < 360; i++) {
      body.y += speed * DT;
      rig.update(DT, body, { x: 0, y: speed }, "walk");
      const up = new Set(
        rig
          .feet()
          .map((foot, leg) => (foot.stepping ? leg : -1))
          .filter((leg) => leg >= 0)
      );
      expect(up.size).toBeLessThanOrEqual(4);
      // Legs in the air at once all belong to the same group.
      expect(new Set([...up].map(groupOf)).size).toBeLessThanOrEqual(1);
      for (const leg of up) {
        if (!wasUp.has(leg)) steps[groupOf(leg)]++;
      }
      wasUp = up;
    }
    // Over three seconds both groups have stepped, about equally often.
    expect(steps[0]).toBeGreaterThan(8);
    expect(steps[1]).toBeGreaterThan(8);
    expect(Math.abs(steps[0] - steps[1])).toBeLessThanOrEqual(4);
  });

  it("draws its legs in when it dangles", () => {
    const rig = createRig();
    const body = { x: 0, y: 0, angle: 0 };
    rig.place(body);
    const spread = Math.max(...rig.feet().map((f) => Math.hypot(f.x, f.y)));
    for (let i = 0; i < 120; i++) {
      rig.update(DT, body, { x: 0, y: 0 }, "curl");
    }
    const drawnIn = Math.max(...rig.feet().map((f) => Math.hypot(f.x, f.y)));
    expect(drawnIn).toBeLessThan(spread * 0.6);
  });
});
