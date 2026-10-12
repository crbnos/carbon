// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type {
  ProjectCopyElement,
  ProjectCopySource
} from "~/modules/projects/projects.models";
import { planProjectCopy } from "~/modules/projects/projects.models";

function element(
  id: string,
  sequence: number,
  parentId: string | null,
  extra: Partial<ProjectCopyElement> = {}
): ProjectCopyElement {
  return {
    id,
    readableId: `SNS-${sequence}`,
    sequence,
    parentId,
    stateId: "state-1",
    milestoneId: null,
    actualParameterId: null,
    parameterFormula: null,
    name: id,
    type: "Task",
    companyId: "company",
    createdBy: "someone",
    ...extra
  };
}

function source(overrides: Partial<ProjectCopySource>): ProjectCopySource {
  return {
    milestones: [],
    elements: [],
    elementLabels: [],
    links: [],
    materials: [],
    labor: [],
    costs: [],
    ...overrides
  };
}

/** A copied row keeps every source column; the type names only the remapped ones. */
const nameOf = (row: object) => (row as { name?: string }).name;

function counter() {
  let n = 0;
  return (prefix: string) => `${prefix}_${++n}`;
}

describe("planProjectCopy", () => {
  it("keeps a 3-level tree with new ids, children under the new parents", () => {
    const plan = planProjectCopy(
      source({
        elements: [
          element("grandchild", 3, "child"),
          element("root", 1, null),
          element("child", 2, "root")
        ]
      }),
      "new-project",
      "NEW",
      counter()
    );

    const byName = new Map(plan.elements.map((row) => [nameOf(row), row]));
    const root = byName.get("root")!;
    const child = byName.get("child")!;
    const grandchild = byName.get("grandchild")!;

    expect(root.parentId).toBeNull();
    expect(child.parentId).toBe(root.id);
    expect(grandchild.parentId).toBe(child.id);
    for (const row of plan.elements) {
      expect(["root", "child", "grandchild"]).not.toContain(row.id);
      expect(row.projectId).toBe("new-project");
      // States are company-wide: an element keeps its state.
      expect(row.stateId).toBe("state-1");
      expect("companyId" in row).toBe(false);
    }
    // Parents come before their children.
    expect(plan.elements.map(nameOf)).toEqual([
      "root",
      "child",
      "grandchild"
    ]);
  });

  it("points a link's ends at the new elements", () => {
    const plan = planProjectCopy(
      source({
        elements: [element("req", 1, null), element("test", 2, null)],
        links: [
          {
            id: "link",
            fromElementId: "test",
            toElementId: "req",
            linkType: "verifies",
            suspectSince: "2026-10-01T00:00:00Z"
          }
        ]
      }),
      "new-project",
      "NEW",
      counter()
    );

    const ids = new Map(plan.elements.map((row) => [nameOf(row), row.id]));
    expect(plan.links).toHaveLength(1);
    expect(plan.links[0]).toMatchObject({
      fromElementId: ids.get("test"),
      toElementId: ids.get("req"),
      linkType: "verifies",
      projectId: "new-project",
      suspectSince: null
    });
    expect(plan.links[0]!.id).not.toBe("link");
  });

  it("restarts readable ids at NEW-1 in sequence order", () => {
    const plan = planProjectCopy(
      source({
        elements: [
          element("c", 30, null),
          element("a", 7, null),
          element("b", 12, "a")
        ]
      }),
      "new-project",
      "NEW",
      counter()
    );

    const readable = new Map(
      plan.elements.map((row) => [
        nameOf(row),
        [row.readableId, row.sequence]
      ])
    );
    expect(readable.get("a")).toEqual(["NEW-1", 1]);
    expect(readable.get("b")).toEqual(["NEW-2", 2]);
    expect(readable.get("c")).toEqual(["NEW-3", 3]);
    expect(plan.nextElementSequence).toBe(4);
  });

  it("rewrites the readable ids of a formula", () => {
    const plan = planProjectCopy(
      source({
        elements: [
          element("one", 1, null),
          element("two", 2, null),
          element("dry", 20, null),
          element("wet", 21, null),
          element("margin", 22, null, {
            type: "Parameter",
            parameterFormula: "= SNS-20 - SNS-21"
          })
        ]
      }),
      "new-project",
      "NEW",
      counter()
    );

    const margin = plan.elements.find((row) => nameOf(row) === "margin")!;
    expect(margin.parameterFormula).toBe("= NEW-3 - NEW-4");
  });
});
