import type { AvailableVariable } from "@carbon/workflows";
import { createWorkflowCatalog } from "@carbon/workflows";
import { describe, expect, it } from "vitest";
import { decodeTokenId } from "./tokenId";
import {
  pickAccepts,
  type VariableTreeNode,
  variableMenuItems,
  variableTree
} from "./variableMenu";

const catalog = createWorkflowCatalog();

/** The first entity the catalog knows about, so the test tracks real data. */
const entityName = "salesOrder";

const variable: AvailableVariable = {
  nodeId: "t1",
  nodeName: "when-order-created",
  nodeType: "trigger",
  output: "record",
  type: { kind: "entity", of: entityName },
  guaranteed: true
};

/** What a change trigger really hands out: `record` and `after` are the same row. */
const changeTriggerVariables: AvailableVariable[] = [
  variable,
  { ...variable, output: "before" },
  { ...variable, output: "after" }
];

describe("duplicate trigger outputs", () => {
  it("offers `record` and drops the identical `after`", () => {
    const outputs = new Set(
      variableMenuItems(changeTriggerVariables, catalog)
        .map((item) => decodeTokenId(item.id))
        .map((ref) => (ref?.kind === "ref" ? ref.output : undefined))
    );
    expect(outputs).toContain("record");
    expect(outputs).toContain("before");
    expect(outputs).not.toContain("after");
  });

  it("keeps `after` when the step has no `record` to duplicate", () => {
    const items = variableMenuItems(
      [{ ...variable, output: "after" }],
      catalog
    );
    expect(items.length).toBeGreaterThan(0);
  });

  it("drops it from the tree too, so both menus agree", () => {
    const labels = variableTree(
      changeTriggerVariables,
      catalog
    )[0].children?.map((child) => child.label);
    expect(labels).toEqual(["Record", "Previous version"]);
  });
});

describe("variableMenuItems", () => {
  it("expands entity properties instead of stopping at the record", () => {
    const items = variableMenuItems([variable], catalog);
    expect(items.length).toBeGreaterThan(1);
    expect(items[0].label).toBe("When Order Created › Record");
  });

  it("gives every entry an id that decodes back to a ref on the same node", () => {
    for (const item of variableMenuItems([variable], catalog)) {
      const ref = decodeTokenId(item.id);
      expect(ref).toBeDefined();
      if (ref?.kind !== "ref") throw new Error("expected a variable ref");
      expect(ref.nodeId).toBe("t1");
      expect(ref.output).toBe("record");
    }
  });

  it("never offers a path deeper than the picker allows", () => {
    for (const item of variableMenuItems([variable], catalog)) {
      const ref = decodeTokenId(item.id);
      expect(ref?.path.length ?? 0).toBeLessThanOrEqual(2);
    }
  });

  it("drops entries whose type the field cannot take", () => {
    const items = variableMenuItems([variable], catalog, {
      accepts: { kind: "primitive", of: "string" }
    });
    expect(items.length).toBeGreaterThan(0);
    // The record itself is an entity, so it must not survive a string filter.
    expect(items.some((i) => i.label === "When Order Created › Record")).toBe(
      false
    );
  });

  it("offers the current item only inside a loop", () => {
    const hasItem = (inLoop: boolean) =>
      variableMenuItems([], catalog, { inLoop }).some(
        (i) => decodeTokenId(i.id)?.kind === "item"
      );
    expect(hasItem(true)).toBe(true);
    expect(hasItem(false)).toBe(false);
  });

  it("warns when a variable is not guaranteed on this path", () => {
    const [item] = variableMenuItems(
      [{ ...variable, guaranteed: false }],
      catalog
    );
    expect(item.helper).toContain("may be empty");
  });
});

const text = { kind: "primitive", of: "string" } as const;
const number = { kind: "primitive", of: "number" } as const;

describe("pickAccepts", () => {
  it("filters by the field's own type when nothing overrides it", () => {
    expect(pickAccepts(text, undefined)).toEqual(text);
  });

  it("filters by the override when one is given", () => {
    expect(pickAccepts(text, number)).toEqual(number);
  });

  // A clause's left side starts as an empty string literal, so filtering by the rendered
  // type hid every non-string output upstream. An override of `undefined` cannot say that
  // — it reads as an absent prop and falls back to `type`.
  it("drops the filter entirely for 'any', so every variable survives", () => {
    expect(pickAccepts(text, "any")).toBeUndefined();
    expect(
      variableMenuItems([output("result", number)], catalog, {
        accepts: pickAccepts(text, "any")
      })
    ).toHaveLength(1);
    expect(
      variableMenuItems([output("result", number)], catalog, {
        accepts: pickAccepts(text, undefined)
      })
    ).toHaveLength(0);
  });
});

const output = (name: string, type: AvailableVariable["type"]) => ({
  ...variable,
  output: name,
  type
});

/** Every node in the subtree, so a test can assert on leaves without walking by hand. */
function flatten(nodes: VariableTreeNode[]): VariableTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);
}

describe("variableTree", () => {
  it("groups a step's outputs under one root", () => {
    const tree = variableTree(
      [output("subject", text), output("body", text)],
      catalog
    );
    expect(tree).toHaveLength(1);
    expect(tree[0].label).toBe("When Order Created");
    expect(tree[0].children?.map((c) => c.label)).toEqual(["subject", "body"]);
    expect(tree[0].children?.every((c) => c.item)).toBe(true);
  });

  // Hoisting meant clicking the step's name inserted a variable called something else.
  it("keeps a lone output on its own row instead of hoisting it", () => {
    const tree = variableTree([output("subject", text)], catalog);
    expect(tree).toHaveLength(1);
    expect(tree[0].item).toBeUndefined();
    expect(tree[0].children?.map((c) => c.label)).toEqual(["subject"]);
    expect(tree[0].children?.[0].item).toBeDefined();
  });

  it("opens an entity output into its properties", () => {
    const [record] = variableTree([variable], catalog)[0].children ?? [];
    expect(record.item).toBeDefined();
    expect(record.children?.length).toBeGreaterThan(1);
  });

  it("never offers a path deeper than the flat menu allows", () => {
    for (const node of flatten(variableTree([variable], catalog))) {
      if (!node.item) continue;
      expect(decodeTokenId(node.item.id)?.path.length ?? 0).toBeLessThanOrEqual(
        2
      );
    }
  });

  it("hides properties the field cannot accept", () => {
    const tree = variableTree([variable], catalog, { accepts: number });
    for (const node of flatten(tree)) {
      if (!node.item) continue;
      expect(decodeTokenId(node.item.id)).toBeDefined();
    }
    // Every surviving row is either pickable or a door to something pickable.
    expect(flatten(tree).every((n) => n.item || n.children?.length)).toBe(true);
  });

  it("drops a step whose outputs are all incompatible", () => {
    const tree = variableTree([variable], catalog, {
      accepts: { kind: "entity", of: "nothingMatchesThis" }
    });
    expect(tree).toHaveLength(0);
  });

  it("admits a list into a single-value field only when batching", () => {
    const listVariable = {
      ...variable,
      type: {
        kind: "list" as const,
        of: { kind: "primitive" as const, of: "string" as const }
      }
    };
    const single = {
      kind: "primitive" as const,
      of: "string" as const
    };
    expect(
      variableTree([listVariable], catalog, { accepts: single })
    ).toHaveLength(0);
    expect(
      variableTree([listVariable], catalog, { accepts: single, batching: true })
    ).not.toHaveLength(0);
  });

  it("offers the current item only inside a loop", () => {
    expect(
      variableTree([], catalog, { inLoop: true }).some((n) => n.key === "item")
    ).toBe(true);
    expect(
      variableTree([], catalog, { inLoop: false }).some((n) => n.key === "item")
    ).toBe(false);
  });

  // A record prints as its readable id, so a text field offers it alongside its
  // properties. A LIST of records still has no reading in a sentence.
  it("offers the record itself in a text field, and its properties", () => {
    const [record] =
      variableTree([variable], catalog, { textOnly: true })[0].children ?? [];
    expect(record.item).toBeDefined();
    expect(record.children?.length).toBeGreaterThan(0);
    expect(
      variableMenuItems([variable], catalog, { textOnly: true }).map((item) =>
        decodeTokenId(item.id)
      )
    ).toContainEqual(expect.objectContaining({ output: "record", path: [] }));
  });

  it("labels properties through the resolver, not the raw column name", () => {
    const [record] =
      variableTree([variable], catalog, {
        labelFor: (key) => `L:${key}`
      })[0].children ?? [];
    expect(record.children?.every((c) => c.label.startsWith("L:"))).toBe(true);
  });
});
