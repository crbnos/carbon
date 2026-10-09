// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { buildElementTree } from "~/modules/projects/projects.models";

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
