// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  groupTimesheetRows,
  rateOn,
  rollUpCostSummary
} from "~/modules/projects/projects.models";

const rates = [
  { effectiveFrom: "2025-06-01", costRate: 80 },
  { effectiveFrom: "2026-01-01", costRate: 85 }
];

describe("rateOn", () => {
  it("picks the latest rate on or before the date", () => {
    expect(rateOn(rates, "2026-03-15")?.costRate).toBe(85);
  });

  it("returns null before the first rate", () => {
    expect(rateOn(rates, "2025-05-31")).toBeNull();
  });
});

describe("groupTimesheetRows", () => {
  it("makes one row per charge number and category, with the total", () => {
    const entry = (id: string, entryDate: string, hours: number) => ({
      id,
      projectId: "p1",
      projectElementId: "e1",
      laborCategoryId: "c1",
      entryDate,
      hours,
      status: "Draft" as const
    });
    const rows = groupTimesheetRows([
      entry("t1", "2026-03-16", 6),
      entry("t2", "2026-03-17", 7.5),
      entry("t3", "2026-03-18", 2)
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(15.5);
    expect(rows[0].cells["2026-03-17"]).toEqual({
      entryId: "t2",
      hours: 7.5,
      status: "Draft"
    });
  });
});

describe("rollUpCostSummary", () => {
  it("gives a parent its own row plus its two children", () => {
    const row = (projectElementId: string | null, actual: number) => ({
      projectElementId,
      planMaterial: 0,
      planLabor: 0,
      planOther: 0,
      committed: 0,
      actual,
      actualHours: 0
    });
    const { byElement, project } = rollUpCostSummary(
      [
        { id: "parent", parentId: null },
        { id: "a", parentId: "parent" },
        { id: "b", parentId: "parent" }
      ],
      [row("parent", 10), row("a", 20), row("b", 30), row(null, 5)]
    );
    expect(byElement.get("parent")?.actual).toBe(60);
    expect(byElement.get("a")?.actual).toBe(20);
    expect(project.actual).toBe(65);
  });
});
