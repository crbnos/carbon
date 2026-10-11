// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  budgetAvailability,
  type ElementNode,
  nearestBudgetedAncestor,
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
