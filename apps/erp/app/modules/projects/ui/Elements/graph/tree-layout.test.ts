// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  countTraceLinks,
  elementTreePath,
  highlightTraceLinks,
  layoutElementTree,
  type TraceLink,
  type TreeElement
} from "./tree-layout";

const elements: TreeElement[] = [
  { id: "P", parentId: null, type: "Folder", name: "Vehicle" },
  { id: "S1", parentId: "P", type: "System", name: "Powertrain" },
  { id: "R1", parentId: "S1", type: "Requirement", name: "R1" },
  { id: "R2", parentId: "S1", type: "Requirement", name: "R2" },
  { id: "S2", parentId: "S1", type: "System", name: "Motor" },
  { id: "R3", parentId: "S2", type: "Requirement", name: "R3" },
  { id: "T1", parentId: "P", type: "Test Case", name: "T1" },
  { id: "F2", parentId: null, type: "Folder", name: "F2" },
  { id: "O1", parentId: "missing", type: "Requirement", name: "O1" }
];

const nothing = new Set<string>();

function layout(
  args: Partial<Parameters<typeof layoutElementTree>[0]> = {}
): ReturnType<typeof layoutElementTree> {
  return layoutElementTree({
    elements,
    rootId: null,
    collapsed: nothing,
    type: null,
    ...args
  });
}

function box(result: ReturnType<typeof layoutElementTree>, id: string) {
  const found = result.boxes.find((b) => b.id === id);
  if (!found) throw new Error(`no box ${id}`);
  return found;
}

function card(result: ReturnType<typeof layoutElementTree>, id: string) {
  const found = result.cards.find((c) => c.id === id);
  if (!found) throw new Error(`no card ${id}`);
  return found;
}

describe("layoutElementTree", () => {
  it("puts the children of each parent in one box", () => {
    const result = layout();
    expect(result.boxes.map((b) => b.id)).toEqual([
      "box:root",
      "box:P",
      "box:S1",
      "box:S2"
    ]);
    expect(box(result, "box:root").cardIds).toEqual(["P", "F2", "O1"]);
    expect(box(result, "box:P").cardIds).toEqual(["S1", "T1"]);
    expect(result.edges).toHaveLength(3);
    expect(
      result.edges.map((e) => [e.source, e.sourceHandle, e.target])
    ).toEqual([
      ["P", "children", "box:P"],
      ["S1", "children", "box:S1"],
      ["S2", "children", "box:S2"]
    ]);
  });

  it("sizes the boxes and places the cards at fixed offsets", () => {
    const result = layout();
    expect(box(result, "box:P").width).toBe(272);
    expect(box(result, "box:P").height).toBe(232);
    expect(card(result, "S1")).toMatchObject({ x: 8, y: 40 });
    expect(card(result, "T1")).toMatchObject({ x: 8, y: 136 });
    expect(box(result, "box:S1").height).toBe(328);
  });

  it("flows the boxes left to right", () => {
    const result = layout();
    const root = box(result, "box:root");
    const p = box(result, "box:P");
    const s1 = box(result, "box:S1");
    expect(p.x).toBeGreaterThan(root.x + root.width);
    expect(s1.x).toBeGreaterThan(p.x + 272);
  });

  it("shows a collapsed card's box as a count", () => {
    const result = layout({ collapsed: new Set(["S1"]) });
    expect(result.boxes.map((b) => b.id)).not.toContain("box:S2");
    const s1 = box(result, "box:S1");
    expect(s1.cardIds).toEqual([]);
    expect(s1.collapsedCount).toBe(4);
    expect(s1.height).toBe(84);
    expect(card(result, "S1")).toMatchObject({
      isCollapsed: true,
      descendantCount: 4
    });
  });

  it("shows the root's children in the top box", () => {
    const result = layout({ rootId: "S1" });
    expect(result.rootId).toBe("S1");
    const top = result.boxes[0];
    expect(top?.id).toBe("box:S1");
    expect(top?.ownerId).toBe("S1");
    expect(top?.cardIds).toEqual(["R1", "R2", "S2"]);
    expect(result.boxes.map((b) => b.id)).toEqual(["box:S1", "box:S2"]);
    const cardIds = result.cards.map((c) => c.id);
    expect(cardIds).not.toContain("P");
    expect(cardIds).not.toContain("F2");
    expect(cardIds).not.toContain("O1");
  });

  it("ignores an unknown root", () => {
    const result = layout({ rootId: "nope" });
    expect(result.rootId).toBeNull();
    expect(result.boxes.map((b) => b.id)).toEqual([
      "box:root",
      "box:P",
      "box:S1",
      "box:S2"
    ]);
  });

  it("keeps the boxes of a Requirement lens", () => {
    const result = layout({ type: "Requirement" });
    expect(box(result, "box:root").cardIds).toEqual(["O1"]);
    expect(box(result, "box:root").hiddenCount).toBe(2);
    expect(box(result, "box:P").cardIds).toEqual([]);
    expect(box(result, "box:P").hiddenCount).toBe(2);
    expect(box(result, "box:P").height).toBe(84);
    expect(box(result, "box:S1").cardIds).toEqual(["R1", "R2"]);
    expect(box(result, "box:S2").cardIds).toEqual(["R3"]);
    expect(
      result.edges.map((e) => [e.source, e.sourceHandle, e.target])
    ).toEqual([
      ["box:root", "out", "box:P"],
      ["box:P", "out", "box:S1"],
      ["box:S1", "out", "box:S2"]
    ]);
    expect(result.boxes.map((b) => b.id)).not.toContain("box:F2");
  });

  it("drops the boxes with no match under a Test Case lens", () => {
    const result = layout({ type: "Test Case" });
    expect(box(result, "box:root").cardIds).toEqual([]);
    expect(box(result, "box:root").hiddenCount).toBe(3);
    expect(box(result, "box:P").cardIds).toEqual(["T1"]);
    expect(result.boxes.map((b) => b.id)).not.toContain("box:S1");
  });

  it("counts only the matching descendants of a collapsed card", () => {
    const result = layout({
      type: "Requirement",
      collapsed: new Set(["S1"])
    });
    expect(box(result, "box:S1").collapsedCount).toBe(3);
  });
});

describe("elementTreePath", () => {
  it("returns the ancestors, then the root", () => {
    expect(elementTreePath(elements, "S2").map((e) => e.id)).toEqual([
      "P",
      "S1",
      "S2"
    ]);
    expect(elementTreePath(elements, null)).toEqual([]);
    expect(elementTreePath(elements, "nope")).toEqual([]);
  });
});

const links: TraceLink[] = [
  { id: "l1", fromElementId: "T1", toElementId: "R1", linkType: "verifies" },
  { id: "l2", fromElementId: "T9", toElementId: "R1", linkType: "verifies" },
  { id: "l3", fromElementId: "S1", toElementId: "R1", linkType: "satisfies" },
  { id: "l4", fromElementId: "S1", toElementId: "R2", linkType: "satisfies" },
  { id: "l5", fromElementId: "P", toElementId: "R1", linkType: "relates to" }
];

describe("countTraceLinks", () => {
  it("counts the tests into a requirement and the reqs out of a system", () => {
    const counts = countTraceLinks(links);
    expect(counts.get("R1")?.tests).toBe(2);
    expect(counts.get("S1")?.reqs).toBe(2);
    expect(counts.has("P")).toBe(false);
  });
});

describe("highlightTraceLinks", () => {
  it("lights up a requirement's tests", () => {
    const lit = highlightTraceLinks(links, {
      elementId: "R1",
      linkType: "verifies"
    });
    expect(lit.linkIds.size).toBe(2);
    expect(lit.elementIds).toEqual(new Set(["R1", "T1", "T9"]));
  });

  it("lights up a system's requirements", () => {
    const lit = highlightTraceLinks(links, {
      elementId: "S1",
      linkType: "satisfies"
    });
    expect(lit.linkIds.size).toBe(2);
    expect(lit.elementIds).toEqual(new Set(["S1", "R1", "R2"]));
  });
});
