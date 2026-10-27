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
import type { Labels } from "./scene";
import { IDLE_WATCHER } from "./scene";
import type { ShiftPlan } from "./story";
import { actStart, LANTERNS_FOR_LIGHTING, momentAt, planShift } from "./story";

const SIZES = [
  [70, 40],
  [100, 60],
  [135, 76]
] as const;

const LABELS: Labels = {
  stations: ["Wash", "Carve", "Light up", "QC"],
  item: "Jack-o'-lantern",
  inProgress: "In Progress",
  complete: "Completed",
  scrapped: "Scrapped",
  passed: "QC passed",
  rejected: "Rejected"
};

/** Every glyph, then every label's words. */
function text(grid: Grid) {
  let out = "";
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++)
      out += String.fromCharCode(grid.ch[r * grid.cols + c] ?? 32);
    out += "\n";
  }
  for (const label of grid.labels) out += `${label.text}\n`;
  return out;
}

function render(
  plan: ShiftPlan,
  seconds: number,
  cols = 100,
  rows = 60,
  watcher = IDLE_WATCHER,
  labels = LABELS
) {
  const layout = makeLayout(cols, rows, 1.93);
  const buffers = makeBuffers(cols, rows);
  const moment = momentAt(seconds, plan.index);
  const frame = renderFrame(
    buffers,
    layout,
    plan,
    moment,
    seconds,
    watcher,
    labels
  );
  return { frame, grid: buffers.main, layout };
}

function withPlan(overrides: Partial<ShiftPlan>): ShiftPlan {
  return { ...planShift(7, 2), ...overrides };
}

describe("renderFrame", () => {
  it("draws every act, at every panel size, without leaving the grid blank", () => {
    for (const [cols, rows] of SIZES) {
      for (let s = 0; s < 90; s += 3) {
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
    // Each varies on its own, so each is drawn where it shows: a visitor in
    // the witching hour, an event across the shift, weather on the hill.
    const witching = [actStart("witching") + 3, actStart("witching") + 8];
    const wholeShift = [3, 5, 20, 35, 45, 52, 70, 75, 85];
    const onTheHill = [3, 52, 70, 85];
    const cases: [Partial<ShiftPlan>, number[]][] = [
      ...(["witch", "horseman", "spider", "ship"] as const).map(
        (visitor): [Partial<ShiftPlan>, number[]] => [{ visitor }, witching]
      ),
      ...(["none", "reject", "boo", "dance"] as const).map(
        (event): [Partial<ShiftPlan>, number[]] => [{ event }, wholeShift]
      ),
      ...(["clear", "drizzle", "fog"] as const).map(
        (weather): [Partial<ShiftPlan>, number[]] => [{ weather }, onTheHill]
      )
    ];
    for (const [overrides, moments] of cases) {
      const plan = withPlan(overrides);
      for (const s of moments) expect(() => render(plan, s)).not.toThrow();
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

  it("keeps a long translation inside the ticket", () => {
    const plan = planShift(7, 2);
    const long = "x".repeat(60);
    const { grid } = render(plan, actStart("line") + 10, 70, 40, IDLE_WATCHER, {
      ...LABELS,
      item: long,
      inProgress: long,
      stations: [long, long, long, long]
    });
    const status = grid.labels.find((label) => label.text === long);
    expect(status).toBeDefined();
    for (const label of grid.labels) {
      expect(label.x).toBeGreaterThanOrEqual(0);
      expect(label.x + label.cells).toBeLessThanOrEqual(grid.cols);
    }
    // The ticket's labels never overlap one another.
    const row = (y: number) =>
      grid.labels.filter((label) => label.y === y).sort((a, b) => a.x - b.x);
    for (const y of new Set(grid.labels.map((label) => label.y))) {
      const labels = row(y);
      labels.slice(1).forEach((label, i) => {
        const before = labels[i];
        if (before)
          expect(label.x).toBeGreaterThanOrEqual(before.x + before.cells);
      });
    }
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

  it("brings the Line down over the hill from the top while the wipe runs", () => {
    const plan = planShift(7, 2);
    const line = actStart("line");
    const rowsAt = (seconds: number) =>
      text(render(plan, seconds).grid).split("\n").slice(0, 60);
    const settled = rowsAt(line + 2);
    // How many rows, from the top, already show the settled Line.
    const lineRows = (seconds: number) => {
      const rows = rowsAt(seconds);
      let n = 0;
      while (n < rows.length && rows[n] === settled[n]) n++;
      return n;
    };
    const early = lineRows(line + 0.4);
    const half = lineRows(line + 0.75);
    const late = lineRows(line + 1.1);
    expect(early).toBe(0);
    expect(half).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(half);
    expect(late).toBeLessThan(60);
  });
});
