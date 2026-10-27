// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The story's rules: one shift is ninety seconds of six acts, a shift is
// the same however often it is drawn, the hill keeps every lantern it ships
// (but a rejected one), and a full hill rises and starts over.

import { describe, expect, it } from "vitest";
import {
  ACTS,
  actStart,
  LANTERNS_FOR_LIGHTING,
  momentAt,
  planShift,
  processionAfter,
  SHIFT_SECONDS
} from "./story";

describe("momentAt", () => {
  it("plays the six acts in order, ninety seconds a shift", () => {
    expect(SHIFT_SECONDS).toBe(90);
    expect(ACTS.map((act) => act.id)).toEqual([
      "midnight",
      "harvest",
      "line",
      "shipping",
      "witching",
      "dawn"
    ]);
    for (const act of ACTS) {
      const moment = momentAt(actStart(act.id) + 0.5);
      expect(moment.act).toBe(act.id);
      expect(moment.t).toBeCloseTo(0.5);
    }
  });

  it("starts the next shift at midnight, counting from the first", () => {
    const moment = momentAt(SHIFT_SECONDS * 2 + 1, 5);
    expect(moment.shift).toBe(7);
    expect(moment.act).toBe("midnight");
    expect(moment.shiftT).toBeCloseTo(1);
  });
});

describe("planShift", () => {
  it("is the same shift however often it is drawn", () => {
    expect(planShift(42, 6)).toEqual(planShift(42, 6));
  });

  it("differs from shift to shift", () => {
    const faces = new Set(
      Array.from({ length: 12 }, (_, i) =>
        JSON.stringify(planShift(42, i).face)
      )
    );
    expect(faces.size).toBeGreaterThan(6);
  });

  it("walks the moon through its phases, one step of eight per shift", () => {
    expect(planShift(1, 0).moonPhase).toBe(0);
    expect(planShift(1, 4).moonPhase).toBe(0.5);
    expect(planShift(1, 8).moonPhase).toBe(0);
  });

  it("keeps every lantern it ships, until thirteen rise and the hill is empty", () => {
    for (const seed of [1, 2, 3, 7, 99]) {
      let lightings = 0;
      for (let i = 0; i < 40; i++) {
        const plan = planShift(seed, i);
        const next = planShift(seed, i + 1);
        expect(next.procession).toEqual(processionAfter(plan));
        expect(plan.procession.length).toBeLessThan(LANTERNS_FOR_LIGHTING);
        if (plan.event === "reject") {
          expect(next.procession).toHaveLength(plan.procession.length);
        } else if (plan.greatLighting) {
          lightings++;
          expect(plan.procession.length + 1).toBe(LANTERNS_FOR_LIGHTING);
          expect(next.procession).toHaveLength(0);
        } else {
          expect(next.procession).toEqual([...plan.procession, plan.face]);
        }
      }
      expect(lightings).toBeGreaterThan(0);
    }
  });

  it("numbers the work order by shift", () => {
    expect(planShift(1, 0).job).toBe("JOB-1031");
    expect(planShift(1, 3).job).toBe("JOB-1034");
  });

  it("brings every rare event and every visitor sooner or later", () => {
    const events = new Set<string>();
    const visitors = new Set<string>();
    for (let seed = 1; seed < 60; seed++) {
      for (let i = 0; i < 6; i++) {
        const plan = planShift(seed, i);
        events.add(plan.event);
        visitors.add(plan.visitor);
      }
    }
    expect([...events].sort()).toEqual(["boo", "dance", "none", "reject"]);
    expect([...visitors].sort()).toEqual([
      "horseman",
      "ship",
      "spider",
      "witch"
    ]);
  });
});
