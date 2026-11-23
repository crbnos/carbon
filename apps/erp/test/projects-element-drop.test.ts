// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { ProjectElementType } from "~/modules/projects/projects.models";
import { planElementDrop } from "~/modules/projects/projects.models";

const element = (
  id: string,
  parentId: string | null,
  sortOrder: number,
  type: ProjectElementType = "Task"
) => ({ id, parentId, sortOrder, type });

// a ── a1, a2
// b ── b1
// c
const elements = [
  element("a", null, 1, "System"),
  element("a1", "a", 1),
  element("a2", "a", 2),
  element("b", null, 2, "System"),
  element("b1", "b", 1),
  element("c", null, 3)
];

describe("planElementDrop", () => {
  it("moves an element inside another as its last child", () => {
    const plan = planElementDrop(elements, {
      elementId: "c",
      targetId: "a",
      position: "inside"
    });
    expect(plan).toMatchObject({ parentId: "a", isMove: true });
    expect(plan?.order).toEqual([
      { id: "a1", sortOrder: 1 },
      { id: "a2", sortOrder: 2 },
      { id: "c", sortOrder: 3 }
    ]);
    expect(plan?.elements.find((e) => e.id === "c")).toMatchObject({
      parentId: "a",
      sortOrder: 3
    });
  });

  it("moves an element before a sibling under a new parent", () => {
    const plan = planElementDrop(elements, {
      elementId: "b1",
      targetId: "a2",
      position: "before"
    });
    expect(plan).toMatchObject({ parentId: "a", isMove: true });
    expect(plan?.order.map((o) => o.id)).toEqual(["a1", "b1", "a2"]);
  });

  it("moves an element to the top level after a root", () => {
    const plan = planElementDrop(elements, {
      elementId: "a1",
      targetId: "b",
      position: "after"
    });
    expect(plan).toMatchObject({ parentId: null, isMove: true });
    expect(plan?.order.map((o) => o.id)).toEqual(["a", "b", "a1", "c"]);
  });

  it("reorders siblings without a move", () => {
    const plan = planElementDrop(elements, {
      elementId: "a2",
      targetId: "a1",
      position: "before"
    });
    expect(plan).toMatchObject({ parentId: "a", isMove: false });
    expect(plan?.order).toEqual([
      { id: "a2", sortOrder: 1 },
      { id: "a1", sortOrder: 2 }
    ]);
  });

  it("returns null for a drop that changes nothing", () => {
    expect(
      planElementDrop(elements, {
        elementId: "a1",
        targetId: "a2",
        position: "before"
      })
    ).toBeNull();
    expect(
      planElementDrop(elements, {
        elementId: "a2",
        targetId: "a",
        position: "inside"
      })
    ).toBeNull();
    expect(
      planElementDrop(elements, {
        elementId: "a",
        targetId: "a",
        position: "after"
      })
    ).toBeNull();
  });

  it("refuses a drop into the element's own subtree", () => {
    expect(
      planElementDrop(elements, {
        elementId: "a",
        targetId: "a1",
        position: "inside"
      })
    ).toBeNull();
    expect(
      planElementDrop(elements, {
        elementId: "a",
        targetId: "a2",
        position: "after"
      })
    ).toBeNull();
  });

  it("refuses a non-Parameter under a Parameter", () => {
    const withParameter = [
      ...elements,
      element("p", null, 4, "Parameter"),
      element("p1", null, 5, "Parameter")
    ];
    expect(
      planElementDrop(withParameter, {
        elementId: "c",
        targetId: "p",
        position: "inside"
      })
    ).toBeNull();
    expect(
      planElementDrop(withParameter, {
        elementId: "p1",
        targetId: "p",
        position: "inside"
      })
    ).toMatchObject({ parentId: "p", isMove: true });
  });
});
