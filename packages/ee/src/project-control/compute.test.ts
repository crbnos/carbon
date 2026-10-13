// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  budgetAvailability,
  type ElementNode,
  earnedValue,
  holdUntilIssued,
  nearestBudgetedAncestor,
  performanceIndexes,
  plannedValue,
  stopWorkDaysLeft,
  stopWorkEnd,
  subtreeIds
} from "./compute";

const tree: ElementNode[] = [
  { id: "root", parentId: null, budget: null },
  { id: "wbs-1", parentId: "root", budget: 10000 },
  { id: "wbs-1.1", parentId: "wbs-1", budget: null },
  { id: "wbs-1.1.1", parentId: "wbs-1.1", budget: null },
  { id: "wbs-2", parentId: "root", budget: null }
];

describe("budgetAvailability", () => {
  it("is over by 500.00 when the new amount passes a 10,000.00 budget (spec: Budget control)", () => {
    const result = budgetAvailability({
      budget: 10000,
      committed: 6000,
      actual: 3000,
      newAmount: 1500,
      tolerancePercent: 0
    });

    expect(result.over).toBe(true);
    expect(result.overBy).toBe(500);
    expect(result.projected).toBe(10500);
  });

  it("is not over with a 10% tolerance", () => {
    const result = budgetAvailability({
      budget: 10000,
      committed: 6000,
      actual: 3000,
      newAmount: 1500,
      tolerancePercent: 0.1
    });

    expect(result.over).toBe(false);
    expect(result.overBy).toBe(0);
  });
});

describe("nearestBudgetedAncestor", () => {
  it("finds the parent's budget for a charge on a child without one", () => {
    expect(nearestBudgetedAncestor("wbs-1.1.1", tree)).toBe("wbs-1");
  });

  it("returns null when no ancestor has a budget", () => {
    expect(nearestBudgetedAncestor("wbs-2", tree)).toBeNull();
  });
});

describe("subtreeIds", () => {
  it("returns the root and 2 levels of children", () => {
    expect(subtreeIds("wbs-1", tree).sort()).toEqual([
      "wbs-1",
      "wbs-1.1",
      "wbs-1.1.1"
    ]);
  });
});

describe("earned value", () => {
  it("gives BCWP 5,000.00 for a started 50/50 work package with BAC 10,000.00 (spec: Earned value)", () => {
    expect(
      earnedValue({
        technique: "50/50",
        bac: 10000,
        bcws: 5000,
        stateGroup: "Started",
        percent: null,
        milestones: [],
        apportioned: null
      })
    ).toBe(5000);
  });

  it("gives CPI 1.25 and SPI 1 for BCWP 5,000.00, ACWP 4,000.00 and BCWS 5,000.00", () => {
    const indexes = performanceIndexes({
      bac: 10000,
      bcws: 5000,
      bcwp: 5000,
      acwp: 4000
    });

    expect(indexes.cpi).toBe(1.25);
    expect(indexes.spi).toBe(1);
    expect(indexes.cv).toBe(1000);
    expect(indexes.eac).toBe(8000);
    expect(indexes.vac).toBe(2000);
  });

  it("gives BCWS 0 for a 0/100 work package that ends after the period end", () => {
    expect(
      plannedValue({
        technique: "0/100",
        bac: 10000,
        start: "2026-06-01",
        end: "2026-07-31",
        periodEnd: "2026-06-30",
        milestones: []
      })
    ).toBe(0);
  });

  it("spreads BCWS by day: 1–30 June at 15 June is half of BAC", () => {
    expect(
      plannedValue({
        technique: "Percent Complete",
        bac: 10000,
        start: "2026-06-01",
        end: "2026-06-30",
        periodEnd: "2026-06-15",
        milestones: []
      })
    ).toBe(5000);
  });

  it("gives BCWP 3,000.00 when the first of 2 milestones (3,000.00 and 7,000.00) is complete", () => {
    expect(
      earnedValue({
        technique: "Milestone",
        bac: 10000,
        bcws: 0,
        stateGroup: "Started",
        percent: null,
        milestones: [
          { budget: 3000, completed: true },
          { budget: 7000, completed: false }
        ],
        apportioned: null
      })
    ).toBe(3000);
  });

  it("gives Level of Effort BCWP equal to BCWS", () => {
    expect(
      earnedValue({
        technique: "Level of Effort",
        bac: 10000,
        bcws: 4200,
        stateGroup: "Started",
        percent: null,
        milestones: [],
        apportioned: null
      })
    ).toBe(4200);
  });

  it("gives Apportioned BCWP of 2,000.00 for factor 0.1 and a base BCWP of 20,000.00", () => {
    expect(
      earnedValue({
        technique: "Apportioned",
        bac: 5000,
        bcws: 0,
        stateGroup: "Started",
        percent: null,
        milestones: [],
        apportioned: { factor: 0.1, baseBcwp: 20000 }
      })
    ).toBe(2000);
  });

  it("recognizes 400.00 when 4 of a receipt of 10 at 1,000.00 are issued", () => {
    const recognized = holdUntilIssued(
      [
        {
          projectElementId: "wp-1",
          itemId: "item-1",
          postingDate: "2026-06-02",
          quantity: 10,
          amount: 1000
        }
      ],
      [{ itemId: "item-1", postingDate: "2026-06-10", quantity: 4 }],
      "2026-06-30"
    );

    expect(recognized.get("wp-1")).toBe(400);
  });
});

describe("stop-work orders", () => {
  it("ends 90 days after the order date", () => {
    expect(stopWorkEnd("2026-10-01")).toBe("2026-12-30");
  });

  it("counts the days left, never below 0", () => {
    expect(stopWorkDaysLeft("2026-10-11", "2026-10-01")).toBe(80);
    expect(stopWorkDaysLeft("2027-01-15", "2026-10-01")).toBe(0);
  });
});
