// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  applyChangeRequestItems,
  type ChangeRequestItem,
  mergeChangeRequestItem,
  toPlanSnapshot
} from "~/modules/projects/projects.models";

function element(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    projectId: "p1",
    readableId: `SNS-${id}`,
    parentId: null,
    sortOrder: 1,
    type: "System",
    name: `Element ${id}`,
    budget: 1000,
    stateId: "todo",
    ...extra
  };
}

const live = toPlanSnapshot({
  elements: [element("e1"), element("e2", { parentId: "e1" }), element("e3")],
  links: [
    {
      id: "k1",
      projectId: "p1",
      fromElementId: "e2",
      toElementId: "e3",
      linkType: "relates to"
    }
  ],
  materials: [
    {
      id: "m1",
      projectId: "p1",
      projectElementId: "e2",
      itemId: "i1",
      methodType: "Buy",
      quantity: 2
    }
  ],
  labor: [],
  costs: [
    { id: "c1", projectId: "p1", projectElementId: "e1", amount: 50 },
    { id: "c2", projectId: "p1", projectElementId: "e3", amount: 70 }
  ]
});

describe("change request overlay", () => {
  it("folds an Update after an Add into one Add with the merged payload", () => {
    const added = mergeChangeRequestItem(
      null,
      {
        operation: "Add",
        targetTable: "projectElement",
        targetId: "new1",
        payload: { name: "Harness", budget: 100, stateId: "todo" }
      },
      null
    );
    if ("error" in added) throw new Error(added.error);
    const merged = mergeChangeRequestItem(
      added.item,
      {
        operation: "Update",
        targetTable: "projectElement",
        targetId: "new1",
        payload: { budget: 250 }
      },
      null
    );
    if ("error" in merged) throw new Error(merged.error);
    expect(merged.item?.operation).toBe("Add");
    expect(merged.item?.payload).toEqual({
      id: "new1",
      name: "Harness",
      budget: 250,
      stateId: "todo"
    });
  });

  it("removes a deleted element with its subtree, links and plan lines", () => {
    const items: ChangeRequestItem[] = [
      {
        operation: "Delete",
        targetTable: "projectElement",
        targetId: "e1",
        payload: null,
        baseRow: element("e1")
      }
    ];
    const result = applyChangeRequestItems(live, items);
    expect(result.elements.map((row) => row.id)).toEqual(["e3"]);
    expect(result.links).toEqual([]);
    expect(result.materials).toEqual([]);
    expect(result.costs.map((row) => row.id)).toEqual(["c2"]);
  });

  it("changes only the plan-layer fields on an Update", () => {
    const items: ChangeRequestItem[] = [
      {
        operation: "Update",
        targetTable: "projectElement",
        targetId: "e3",
        payload: { budget: 1500, stateId: "done", ownerId: "u9" },
        baseRow: element("e3")
      }
    ];
    const row = applyChangeRequestItems(live, items).elements.find(
      (e) => e.id === "e3"
    );
    expect(row?.budget).toBe(1500);
    expect(row).not.toHaveProperty("stateId");
    expect(row).not.toHaveProperty("ownerId");
    expect(row?.name).toBe("Element e3");
  });

  it("leaves nothing for a Delete after an Add", () => {
    const added = mergeChangeRequestItem(
      null,
      {
        operation: "Add",
        targetTable: "projectElementCost",
        targetId: "c9",
        payload: { projectElementId: "e3", description: "Test", amount: 5 }
      },
      null
    );
    if ("error" in added) throw new Error(added.error);
    const deleted = mergeChangeRequestItem(
      added.item,
      {
        operation: "Delete",
        targetTable: "projectElementCost",
        targetId: "c9",
        payload: null
      },
      null
    );
    expect(deleted).toEqual({ item: null });
  });
});
