import type { AvailableVariable } from "@carbon/workflows";
import { createWorkflowCatalog } from "@carbon/workflows";
import { describe, expect, it } from "vitest";
import { decodeTokenId } from "./tokenId";
import { variableMenuItems } from "./variableMenu";

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

describe("variableMenuItems", () => {
  it("expands entity properties instead of stopping at the record", () => {
    const items = variableMenuItems([variable], catalog);
    expect(items.length).toBeGreaterThan(1);
    expect(items[0].label).toBe("when-order-created › record");
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
    expect(items.some((i) => i.label === "when-order-created › record")).toBe(
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
