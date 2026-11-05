// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { reducer } from "~/components/TreeView/reducer";
import type { Filter, FlatTree } from "~/components/TreeView/TreeView";
import {
  applyFilterToState,
  concreteStateFromInput
} from "~/components/TreeView/utils";

type Row = { name: string };

const item = (
  id: string,
  name: string,
  parentId?: string,
  children: string[] = []
) => ({
  id,
  parentId,
  children,
  hasChildren: children.length > 0,
  level: parentId ? 1 : 0,
  data: { name }
});

const tree: FlatTree<Row> = [
  item("a", "Satellite bus", undefined, ["a1", "a2"]),
  item("a1", "Bus dry mass", "a"),
  item("a2", "Solar array", "a"),
  item("b", "Payload", undefined)
];

const filter: Filter<Row, { text: string }> = {
  value: { text: "mass" },
  fn: (value, node) => node.data.name.toLowerCase().includes(value.text)
};

describe("the tree filter", () => {
  it("applies to the initial state", () => {
    const state = applyFilterToState(
      concreteStateFromInput({
        tree,
        filter,
        selectedId: undefined,
        collapsedIds: undefined
      })
    );
    expect(state.visibleNodeIds).toEqual(["a", "a1"]);
  });

  it("still applies after the tree data reloads", () => {
    const state = applyFilterToState(
      concreteStateFromInput({
        tree,
        filter,
        selectedId: undefined,
        collapsedIds: undefined
      })
    );
    const reloaded = reducer(state, {
      type: "UPDATE_TREE",
      payload: { tree: tree.map((node) => ({ ...node })) }
    });
    expect(reloaded.visibleNodeIds).toEqual(["a", "a1"]);
  });
});
