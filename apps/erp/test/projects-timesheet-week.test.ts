// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  groupTimesheetRows,
  rateOn,
  preproductionActual,
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
      actualUnallowable: 0,
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

  it("gives a parent the unallowable actual of its child", () => {
    const row = (
      projectElementId: string,
      actual: number,
      actualUnallowable: number
    ) => ({
      projectElementId,
      planMaterial: 0,
      planLabor: 0,
      planOther: 0,
      committed: 0,
      actual,
      actualUnallowable,
      actualHours: 0
    });
    const { byElement, project } = rollUpCostSummary(
      [
        { id: "parent", parentId: null },
        { id: "child", parentId: "parent" }
      ],
      [row("parent", 40, 0), row("child", 100, 100)]
    );
    expect(byElement.get("parent")?.unallowable).toBe(100);
    expect(byElement.get("parent")?.actual).toBe(140);
    expect(project.unallowable).toBe(100);
  });
});

describe("preproductionActual", () => {
  it("counts a preproduction subtree once", () => {
    const elements = [
      { id: "root", parentId: null, isPreproduction: false },
      { id: "pre", parentId: "root", isPreproduction: true },
      { id: "pre-child", parentId: "pre", isPreproduction: true },
      { id: "other", parentId: "root", isPreproduction: false }
    ];
    const byElement = new Map([
      ["root", { actual: 100 }],
      ["pre", { actual: 60 }],
      ["pre-child", { actual: 25 }],
      ["other", { actual: 40 }]
    ]);
    expect(preproductionActual(elements, byElement)).toBe(60);
  });
});
