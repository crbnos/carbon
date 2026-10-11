// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  apportionedBaseRefusal,
  buildElementTree,
  buildReaderOutline
} from "~/modules/projects/projects.models";

const element = (id: string, parentId: string | null, sortOrder: number) => ({
  id,
  parentId,
  sortOrder
});

describe("buildElementTree", () => {
  it("walks three levels depth-first", () => {
    const tree = buildElementTree([
      element("c", "b", 1),
      element("a", null, 1),
      element("b", "a", 1),
      element("d", null, 2)
    ]);
    expect(tree.map((item) => [item.id, item.level])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["d", 0]
    ]);
    expect(tree[0]).toMatchObject({ children: ["b"], hasChildren: true });
    expect(tree[2]).toMatchObject({ parentId: "b", hasChildren: false });
  });

  it("orders siblings by sortOrder", () => {
    const tree = buildElementTree([
      element("first", null, 2),
      element("second", null, 1)
    ]);
    expect(tree.map((item) => item.id)).toEqual(["second", "first"]);
  });

  it("shows a child whose parent is not in the input at level 0", () => {
    const tree = buildElementTree([element("orphan", "filtered-out", 1)]);
    expect(tree).toEqual([
      expect.objectContaining({ id: "orphan", level: 0, parentId: undefined })
    ]);
  });
});

describe("buildReaderOutline", () => {
  it("numbers the outline in tree order", () => {
    const outline = buildReaderOutline([
      element("a", null, 1),
      element("b", "a", 1),
      element("c", "a", 2),
      element("d", "c", 1),
      element("e", null, 2)
    ]);
    expect(outline.map((entry) => [entry.element.id, entry.number])).toEqual([
      ["a", "1"],
      ["b", "1.1"],
      ["c", "1.2"],
      ["d", "1.2.1"],
      ["e", "2"]
    ]);
  });
});

describe("apportionedBaseRefusal", () => {
  const node = (
    id: string,
    technique: string | null = null,
    base: string | null = null
  ) => ({
    id,
    readableId: id.toUpperCase(),
    name: `Element ${id}`,
    earnedValueTechnique: technique,
    apportionedToElementId: base
  });

  it("refuses to delete the base of an Apportioned element outside the subtree", () => {
    const refusal = apportionedBaseRefusal(
      ["b", "b1"],
      [node("a", "Apportioned", "b1"), node("b"), node("b1")]
    );
    expect(refusal).toBe(
      "B1 Element b1 is the base of apportioned element A Element a. Change that element first."
    );
  });

  it("allows the delete when the Apportioned element is in the subtree too", () => {
    expect(
      apportionedBaseRefusal(
        ["b", "b1"],
        [node("b"), node("b1", "Apportioned", "b")]
      )
    ).toBeNull();
  });

  it("allows the delete when no Apportioned element points into the subtree", () => {
    expect(
      apportionedBaseRefusal(
        ["b"],
        [node("a", "Apportioned", "c"), node("b"), node("c")]
      )
    ).toBeNull();
  });
});
