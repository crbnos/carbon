// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  diffPlanSnapshots,
  toPlanSnapshot
} from "~/modules/projects/projects.models";

function element(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    companyId: "c1",
    projectId: "p1",
    readableId: `SNS-${id}`,
    parentId: null,
    sortOrder: 1,
    type: "Requirement",
    name: `Element ${id}`,
    stateId: "todo",
    ownerId: null,
    budget: 1000,
    createdBy: "u1",
    updatedAt: "2026-10-09T09:00:00Z",
    ...extra
  };
}

function link(id: string, fromElementId: string, toElementId: string) {
  return {
    id,
    companyId: "c1",
    projectId: "p1",
    fromElementId,
    toElementId,
    linkType: "verifies",
    suspectSince: null
  };
}

function material(id: string, quantity: number) {
  return {
    id,
    companyId: "c1",
    projectId: "p1",
    projectElementId: "1",
    itemId: "item-1",
    methodType: "Buy",
    quantity,
    unitOfMeasureCode: "EA",
    requiredDate: null,
    quantityIssued: 0,
    unitCost: 12.5
  };
}

const empty = { links: [], materials: [], labor: [], costs: [] };

describe("toPlanSnapshot", () => {
  it("drops a progress field and keeps the budget", () => {
    const snapshot = toPlanSnapshot({ ...empty, elements: [element("1")] });

    expect(snapshot.elements).toHaveLength(1);
    expect(snapshot.elements[0]).not.toHaveProperty("stateId");
    expect(snapshot.elements[0]).not.toHaveProperty("companyId");
    expect(snapshot.elements[0]?.budget).toBe(1000);
  });

  it("returns each element's start and target date in schedule", () => {
    const snapshot = toPlanSnapshot({
      ...empty,
      elements: [
        element("2", { startDate: "2026-06-01", targetDate: "2026-06-30" }),
        element("1")
      ]
    });

    expect(snapshot.schedule).toEqual([
      { id: "1", startDate: null, targetDate: null },
      { id: "2", startDate: "2026-06-01", targetDate: "2026-06-30" }
    ]);
    expect(snapshot.elements[1]).not.toHaveProperty("targetDate");
  });
});

describe("diffPlanSnapshots", () => {
  it("reports an added element, a removed link and a changed plan-line quantity", () => {
    const base = toPlanSnapshot({
      elements: [element("1"), element("2")],
      links: [link("l1", "1", "2")],
      materials: [material("m1", 2)],
      labor: [],
      costs: []
    });
    const target = toPlanSnapshot({
      elements: [element("1"), element("2"), element("3")],
      links: [],
      materials: [material("m1", 5)],
      labor: [],
      costs: []
    });

    const diff = diffPlanSnapshots(base, target);

    expect(
      diff.elements
        .filter((e) => e.status !== "unchanged")
        .map((e) => [e.status, e.after?.id])
    ).toEqual([["added", "3"]]);
    expect(diff.links.map((e) => [e.status, e.before?.id])).toEqual([
      ["removed", "l1"]
    ]);
    expect(diff.materials).toHaveLength(1);
    expect(diff.materials[0]?.status).toBe("modified");
    expect(diff.materials[0]?.changedFields).toEqual({
      quantity: { before: 2, after: 5 }
    });
  });

  it("gives no diff for a changed state alone", () => {
    const base = toPlanSnapshot({ ...empty, elements: [element("1")] });
    const target = toPlanSnapshot({
      ...empty,
      elements: [element("1", { stateId: "done", ownerId: "u2" })]
    });

    const diff = diffPlanSnapshots(base, target);

    expect(diff.elements.map((e) => e.status)).toEqual(["unchanged"]);
  });

  it("gives no diff for a changed target date alone", () => {
    const base = toPlanSnapshot({
      ...empty,
      elements: [element("1", { targetDate: "2026-06-30" })]
    });
    const target = toPlanSnapshot({
      ...empty,
      elements: [element("1", { targetDate: "2026-07-31" })]
    });

    const diff = diffPlanSnapshots(base, target);

    expect(diff.elements.map((e) => e.status)).toEqual(["unchanged"]);
  });
});
