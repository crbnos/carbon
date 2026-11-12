// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  cumulativeLeadTimes,
  type LeadTimeItem
} from "./cumulative-lead-time.ts";

const make = (leadTime: number): LeadTimeItem => ({
  leadTime,
  replenishmentSystem: "Make"
});
const buy = (leadTime: number): LeadTimeItem => ({
  leadTime,
  replenishmentSystem: "Buy"
});

describe("cumulativeLeadTimes", () => {
  it("adds the longest component path to a make item's own build time", () => {
    // ASSY (5) → SUB (7) → BOLT bought (14); ASSY also uses PAINT bought (3).
    const result = cumulativeLeadTimes(
      new Map([
        ["ASSY", make(5)],
        ["SUB", make(7)],
        ["BOLT", buy(14)],
        ["PAINT", buy(3)]
      ]),
      [
        { parentItemId: "ASSY", childItemId: "SUB" },
        { parentItemId: "ASSY", childItemId: "PAINT" },
        { parentItemId: "SUB", childItemId: "BOLT" }
      ]
    );
    expect(result.get("ASSY")).toBe(26);
    expect(result.get("SUB")).toBe(21);
    expect(result.get("BOLT")).toBe(14);
  });

  it("stops at a bought item even when it has a make method", () => {
    const result = cumulativeLeadTimes(
      new Map([
        ["RESOLD", buy(10)],
        ["PART", make(40)]
      ]),
      [{ parentItemId: "RESOLD", childItemId: "PART" }]
    );
    expect(result.get("RESOLD")).toBe(10);
  });

  it("counts a sub-assembly used twice once on the longest path", () => {
    const result = cumulativeLeadTimes(
      new Map([
        ["TOP", make(2)],
        ["LEFT", make(3)],
        ["RIGHT", make(9)],
        ["SHARED", make(4)]
      ]),
      [
        { parentItemId: "TOP", childItemId: "LEFT" },
        { parentItemId: "TOP", childItemId: "RIGHT" },
        { parentItemId: "LEFT", childItemId: "SHARED" },
        { parentItemId: "RIGHT", childItemId: "SHARED" }
      ]
    );
    // TOP 2 + RIGHT 9 + SHARED 4
    expect(result.get("TOP")).toBe(15);
  });

  it("ends a cycle instead of recursing forever", () => {
    const result = cumulativeLeadTimes(
      new Map([
        ["A", make(1)],
        ["B", make(2)]
      ]),
      [
        { parentItemId: "A", childItemId: "B" },
        { parentItemId: "B", childItemId: "A" }
      ]
    );
    expect(result.get("A")).toBe(3);
  });

  it("uses the 7-day default for an item with no lead time row", () => {
    const result = cumulativeLeadTimes(new Map([["ASSY", make(5)]]), [
      { parentItemId: "ASSY", childItemId: "UNKNOWN" }
    ]);
    expect(result.get("ASSY")).toBe(12);
  });
});
