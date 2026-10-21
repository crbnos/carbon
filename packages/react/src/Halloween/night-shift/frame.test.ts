// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Any instant of the story renders, on any panel size: every act, every
// visitor, every rare event and the Great Lighting. Plus the few things
// a reader of the frame should be able to count on.

import { describe, expect, it } from "vitest";
import { miniFace } from "./faces";
import { makeBuffers, renderFrame } from "./frame";
import type { Grid } from "./grid";
import { makeLayout } from "./layout";
import { IDLE_WATCHER } from "./scene";
import type { ShiftPlan } from "./story";
import { actStart, LANTERNS_FOR_LIGHTING, momentAt, planShift } from "./story";

const SIZES = [
  [70, 40],
  [100, 60],
  [135, 76]
] as const;

function text(grid: Grid) {
  let out = "";
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++)
      out += String.fromCharCode(grid.ch[r * grid.cols + c] ?? 32);
    out += "\n";
  }
  return out;
}

function render(
  plan: ShiftPlan,
  seconds: number,
  cols = 100,
  rows = 60,
  watcher = IDLE_WATCHER
) {
  const layout = makeLayout(cols, rows, 1.93);
  const buffers = makeBuffers(cols, rows);
  const moment = momentAt(seconds, plan.index);
  const frame = renderFrame(buffers, layout, plan, moment, seconds, watcher);
  return { frame, grid: buffers.main, layout };
}

function withPlan(overrides: Partial<ShiftPlan>): ShiftPlan {
  return { ...planShift(7, 2), ...overrides };
}

describe("renderFrame", () => {
  it("draws every act, at every panel size, without leaving the grid blank", () => {
    for (const [cols, rows] of SIZES) {
      for (let s = 0; s < 90; s += 1.5) {
        const { grid, frame } = render(planShift(7, 2), s, cols, rows);
        const glyphs = grid.ch.reduce(
          (n, code) => n + (code === 32 ? 0 : 1),
          0
        );
        expect(glyphs).toBeGreaterThan(cols * rows * 0.05);
        expect(frame.flash).toBeGreaterThanOrEqual(0);
        expect(frame.flash).toBeLessThanOrEqual(1);
      }
    }
  });

  it("draws every visitor, rare event and weather", () => {
    for (const visitor of ["witch", "horseman", "spider", "ship"] as const) {
      for (const event of ["none", "reject", "boo", "dance"] as const) {
        for (const weather of ["clear", "drizzle", "fog"] as const) {
          const plan = withPlan({ visitor, event, weather });
          for (const s of [3, 5, 20, 35, 45, 52, 70, 75, 85]) {
            expect(() => render(plan, s)).not.toThrow();
          }
        }
      }
    }
  });

  it("shows the Line's work order, ticking to Complete after QC", () => {
    const plan = planShift(7, 2);
    const during = text(render(plan, actStart("line") + 10).grid);
    expect(during).toContain(plan.job);
    expect(during).toContain("In Progress");
    const after = text(render(plan, actStart("line") + 23).grid);
    expect(after).toContain("Complete");
    expect(after).toContain("QC PASSED");
  });

  it("scraps a rejected pumpkin", () => {
    const plan = withPlan({ event: "reject" });
    const after = text(render(plan, actStart("line") + 22).grid);
    expect(after).toContain("Scrapped");
    expect(after).toContain("REJECTED");
  });

  it("stands the procession on the hill, the shipped lantern among them", () => {
    const plan = planShift(7, 2);
    const before = text(render(plan, actStart("harvest") + 2).grid);
    for (const face of plan.procession)
      expect(before).toContain(miniFace(face));
    const after = text(render(plan, actStart("witching") + 1).grid);
    expect(after).toContain(miniFace(plan.face));
  });

  it("turns every lantern away while a secret is typed", () => {
    const plan = planShift(7, 2);
    const watcher = { ...IDLE_WATCHER, secret: true };
    const frame = text(
      render(plan, actStart("harvest") + 2, 100, 60, watcher).grid
    );
    for (const face of plan.procession)
      expect(frame).not.toContain(miniFace(face));
    expect(frame).toContain("(:|:)");
  });

  it("lights thirteen stars for the Great Lighting", () => {
    let index = 0;
    while (!planShift(7, index).greatLighting) index++;
    const plan = planShift(7, index);
    const { frame } = render(plan, actStart("dawn") + 2);
    const stars = frame.lights.filter((light) => (light.halo ?? 0) > 0.2);
    expect(stars.length).toBeGreaterThanOrEqual(LANTERNS_FOR_LIGHTING);
  });

  it("wipes between the hill and the Line with a curtain of glyphs", () => {
    const plan = planShift(7, 2);
    const half = render(plan, actStart("line") + 0.75);
    const glyphs = text(half.grid);
    expect(glyphs).toMatch(/[*+x%#@&?!]/);
  });
});
