import { describe, expect, it } from "vitest";
import { INITIAL_NAV, type NavState, navigate, rowsAt } from "./menuNav";
import type { VariableTreeNode } from "./variableMenu";

const item = (id: string) => ({ id, label: id });

/** step → record (entity, pickable and openable) → two properties, plus a sibling leaf
 * and a group that can only be drilled into. */
const tree: VariableTreeNode[] = [
  {
    key: "record",
    label: "Record",
    item: item("record"),
    children: [
      { key: "name", label: "Name", item: item("name") },
      { key: "email", label: "Email", item: item("email") }
    ]
  },
  { key: "count", label: "Count", item: item("count") },
  {
    key: "group",
    label: "Group",
    children: [{ key: "inner", label: "Inner", item: item("inner") }]
  }
];

const opts = { backspacePops: false, queryEmpty: true };
const at = (path: string[], index: number): NavState => ({ path, index });

const stateOf = (result: ReturnType<typeof navigate>) => {
  if (!result.handled || !("state" in result)) {
    throw new Error("expected a state result");
  }
  return result.state;
};

describe("rowsAt", () => {
  it("returns the root for an empty path", () => {
    expect(rowsAt(tree, []).map((r) => r.key)).toEqual([
      "record",
      "count",
      "group"
    ]);
  });

  it("descends into a node's children", () => {
    expect(rowsAt(tree, ["record"]).map((r) => r.key)).toEqual([
      "name",
      "email"
    ]);
  });

  it("falls back to the root when the path no longer exists", () => {
    expect(rowsAt(tree, ["gone"])).toBe(tree);
    expect(rowsAt(tree, ["count"])).toBe(tree);
  });
});

describe("navigate — moving within a level", () => {
  it("wraps past the end", () => {
    expect(stateOf(navigate("ArrowDown", at([], 2), tree, opts)).index).toBe(0);
  });

  it("wraps past the start", () => {
    expect(stateOf(navigate("ArrowUp", at([], 0), tree, opts)).index).toBe(2);
  });

  it("moves down and up by one", () => {
    expect(stateOf(navigate("ArrowDown", at([], 0), tree, opts)).index).toBe(1);
    expect(stateOf(navigate("ArrowUp", at([], 2), tree, opts)).index).toBe(1);
  });

  it("jumps to the first and last row", () => {
    expect(stateOf(navigate("Home", at([], 2), tree, opts)).index).toBe(0);
    expect(stateOf(navigate("End", at([], 0), tree, opts)).index).toBe(2);
  });
});

describe("navigate — moving between levels", () => {
  it("descends with ArrowRight when the row has children", () => {
    expect(stateOf(navigate("ArrowRight", INITIAL_NAV, tree, opts))).toEqual({
      path: ["record"],
      index: 0
    });
  });

  it("swallows ArrowRight on a leaf without moving", () => {
    const state = at([], 1);
    const result = navigate("ArrowRight", state, tree, opts);
    expect(result).toEqual({ handled: true, state });
  });

  it("ascends with ArrowLeft and restores the parent's row", () => {
    expect(
      stateOf(navigate("ArrowLeft", at(["group"], 0), tree, opts))
    ).toEqual({ path: [], index: 2 });
  });

  it("leaves ArrowLeft to the host at the root", () => {
    expect(navigate("ArrowLeft", INITIAL_NAV, tree, opts)).toEqual({
      handled: false
    });
  });
});

describe("navigate — Enter", () => {
  it("selects a leaf", () => {
    expect(navigate("Enter", at([], 1), tree, opts)).toEqual({
      handled: true,
      select: item("count")
    });
  });

  it("descends into a group that has nothing to pick", () => {
    expect(stateOf(navigate("Enter", at([], 2), tree, opts))).toEqual({
      path: ["group"],
      index: 0
    });
  });

  it("selects rather than descends when a row is both", () => {
    expect(navigate("Enter", at([], 0), tree, opts)).toEqual({
      handled: true,
      select: item("record")
    });
  });
});

describe("navigate — Escape and Backspace", () => {
  it("closes on Escape", () => {
    expect(navigate("Escape", INITIAL_NAV, tree, opts)).toEqual({
      handled: true,
      close: true
    });
  });

  it("pops a level on Backspace only when all three conditions hold", () => {
    const drilled = at(["record"], 1);
    expect(
      stateOf(
        navigate("Backspace", drilled, tree, {
          backspacePops: true,
          queryEmpty: true
        })
      )
    ).toEqual({ path: [], index: 0 });

    expect(
      navigate("Backspace", drilled, tree, {
        backspacePops: false,
        queryEmpty: true
      })
    ).toEqual({ handled: false });

    expect(
      navigate("Backspace", drilled, tree, {
        backspacePops: true,
        queryEmpty: false
      })
    ).toEqual({ handled: false });

    expect(
      navigate("Backspace", INITIAL_NAV, tree, {
        backspacePops: true,
        queryEmpty: true
      })
    ).toEqual({ handled: false });
  });
});

describe("navigate — an empty tree", () => {
  it("still closes on Escape and defers everything else", () => {
    expect(navigate("Escape", INITIAL_NAV, [], opts)).toEqual({
      handled: true,
      close: true
    });
    expect(navigate("ArrowDown", INITIAL_NAV, [], opts)).toEqual({
      handled: false
    });
  });
});
