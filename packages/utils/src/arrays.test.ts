// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { withPathIds, withUnorderedLast } from "./arrays";

describe("withUnorderedLast", () => {
  it("keeps the saved order and appends an id that arrived later", () => {
    expect(withUnorderedLast(["b", "a"], ["a", "b", "c"])).toEqual([
      "b",
      "a",
      "c"
    ]);
  });

  it("uses the current order when nothing was saved", () => {
    expect(withUnorderedLast([], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("keeps a saved id that is not current, so it returns to its place", () => {
    expect(withUnorderedLast(["a", "hidden", "b"], ["a", "b"])).toEqual([
      "a",
      "hidden",
      "b"
    ]);
  });

  it("names each id once", () => {
    const order = withUnorderedLast(["a", "b"], ["b", "a", "c"]);
    expect(new Set(order).size).toBe(order.length);
  });
});

describe("withPathIds", () => {
  type Node = { id: string; children: Node[] };
  const leaf = (id: string): Node => ({ id, children: [] });
  // One sub-assembly object used under two parents, as the builder produces.
  const shared: Node = { id: "sub", children: [leaf("bolt")] };
  const tree = (): Node[] => [
    { id: "root", children: [{ id: "a", children: [shared] }, shared] }
  ];
  const ids = (nodes: Node[]): string[] =>
    nodes.flatMap((n) => [n.id, ...ids(n.children)]);

  it("gives every place a node appears an id of its own", () => {
    const all = ids(withPathIds(tree()));
    expect(new Set(all).size).toBe(all.length);
    expect(all).toContain("root/a/sub/bolt");
    expect(all).toContain("root/sub/bolt");
  });

  it("gives the same ids on every load", () => {
    expect(ids(withPathIds(tree()))).toEqual(ids(withPathIds(tree())));
  });

  it("tells apart a node listed twice under one parent", () => {
    const all = ids(
      withPathIds([{ id: "root", children: [leaf("x"), leaf("x")] }])
    );
    expect(all).toEqual(["root", "root/x", "root/x#1"]);
  });

  it("does not change the tree it was given", () => {
    const input = tree();
    withPathIds(input);
    expect(ids(input)).toEqual(["root", "a", "sub", "bolt", "sub", "bolt"]);
  });
});
