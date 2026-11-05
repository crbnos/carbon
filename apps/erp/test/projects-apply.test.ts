// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type ChangeRequestItem,
  findConflicts,
  pickPlanLayerFields,
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
    ...extra
  };
}

const empty = { links: [], materials: [], labor: [], costs: [] };

/** An Update item that set the budget of `e1` from 1000 to 1200. */
const budgetUpdate: ChangeRequestItem = {
  operation: "Update",
  targetTable: "projectElement",
  targetId: "e1",
  baseRow: pickPlanLayerFields("projectElement", element("e1")),
  payload: pickPlanLayerFields(
    "projectElement",
    element("e1", { budget: 1200 })
  )
};

describe("findConflicts", () => {
  it("finds no conflict when the live plan did not change", () => {
    const live = toPlanSnapshot({ elements: [element("e1")], ...empty });
    expect(findConflicts([budgetUpdate], live)).toEqual([]);
  });

  it("finds a conflict on budget when the live budget changed", () => {
    const live = toPlanSnapshot({
      elements: [element("e1", { budget: 900 })],
      ...empty
    });
    expect(findConflicts([budgetUpdate], live)).toEqual([
      {
        targetTable: "projectElement",
        targetId: "e1",
        operation: "Update",
        fields: ["budget"],
        missing: false
      }
    ]);
  });

  it("finds a conflict when the live row was deleted", () => {
    const live = toPlanSnapshot({ elements: [element("e2")], ...empty });
    expect(findConflicts([budgetUpdate], live)).toEqual([
      {
        targetTable: "projectElement",
        targetId: "e1",
        operation: "Update",
        fields: [],
        missing: true
      }
    ]);
  });
});
