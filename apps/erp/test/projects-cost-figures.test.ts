// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildProjectCostFigures,
  elementSubtreeIds,
  estimateAtCompletion
} from "~/modules/projects/projects.models";

const row = (
  projectElementId: string | null,
  plan: number,
  committed: number,
  actual: number
) => ({
  projectElementId,
  planMaterial: plan,
  planLabor: 0,
  planOther: 0,
  committed,
  actual,
  actualHours: 0
});

describe("estimateAtCompletion", () => {
  it("adds the unspent plan to actual and committed", () => {
    expect(estimateAtCompletion({ plan: 100, committed: 20, actual: 30 })).toBe(
      100
    );
  });

  it("never goes below actual and committed", () => {
    expect(estimateAtCompletion({ plan: 40, committed: 20, actual: 30 })).toBe(
      50
    );
  });

  it("uses the override when one is set", () => {
    expect(
      estimateAtCompletion({ plan: 40, committed: 20, actual: 30, override: 0 })
    ).toBe(0);
  });
});

describe("elementSubtreeIds", () => {
  const elements = [
    { id: "a", parentId: null },
    { id: "b", parentId: "a" },
    { id: "c", parentId: "b" },
    { id: "d", parentId: null }
  ];

  it("returns the element and everything below it", () => {
    expect(elementSubtreeIds(elements, "a").sort()).toEqual(["a", "b", "c"]);
    expect(elementSubtreeIds(elements, "d")).toEqual(["d"]);
  });

  it("returns nothing for an unknown element", () => {
    expect(elementSubtreeIds(elements, "x")).toEqual([]);
  });
});

describe("buildProjectCostFigures", () => {
  it("rolls figures and budgets up the tree", () => {
    const { byElement, project } = buildProjectCostFigures(
      [
        { id: "a", parentId: null, budget: 500, estimateAtCompletion: null },
        { id: "b", parentId: "a", budget: 200, estimateAtCompletion: null },
        { id: "c", parentId: "a", budget: null, estimateAtCompletion: 75 },
        { id: "d", parentId: null, budget: null, estimateAtCompletion: null }
      ],
      [row("b", 150, 40, 100), row("c", 50, 0, 60), row(null, 0, 0, 10)]
    );

    expect(byElement.get("a")).toMatchObject({
      plan: 200,
      budget: 700,
      committed: 40,
      actual: 160,
      remaining: 500,
      estimateAtCompletion: 200
    });
    expect(byElement.get("b")).toMatchObject({
      budget: 200,
      remaining: 60,
      estimateAtCompletion: 150
    });
    expect(byElement.get("c")).toMatchObject({
      budget: null,
      remaining: null,
      estimateAtCompletion: 75
    });
    expect(byElement.get("d")).toMatchObject({ budget: null, actual: 0 });
    expect(project).toMatchObject({
      plan: 200,
      budget: 700,
      committed: 40,
      actual: 170,
      remaining: 490,
      estimateAtCompletion: 210
    });
  });

  it("adds the child service orders' actual to the project total only", () => {
    const { byElement, project } = buildProjectCostFigures(
      [{ id: "a", parentId: null, budget: 500, estimateAtCompletion: null }],
      [row("a", 200, 0, 100)],
      300
    );

    expect(byElement.get("a")).toMatchObject({ actual: 100, remaining: 400 });
    expect(project).toMatchObject({
      actual: 400,
      remaining: 100,
      estimateAtCompletion: 400
    });
  });
});
