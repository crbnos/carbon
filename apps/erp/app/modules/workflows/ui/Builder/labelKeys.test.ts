import { describe, expect, it } from "vitest";
import {
  describeValueType,
  isDefaultNodeName,
  nodeNameLabel,
  nodeTitle,
  outputLabel
} from "./labelKeys";

describe("nodeNameLabel", () => {
  it("titles a stored slug", () => {
    expect(nodeNameLabel("when_order_created")).toBe("When Order Created");
  });

  it("treats a hyphen the same as an underscore", () => {
    expect(nodeNameLabel("when-order-created")).toBe("When Order Created");
  });

  it("drops empty segments rather than emitting double spaces", () => {
    expect(nodeNameLabel("__notify__")).toBe("Notify");
  });
});

describe("outputLabel", () => {
  it("names the three outputs of a change trigger", () => {
    expect(outputLabel("record")).toBe("Record");
    expect(outputLabel("before")).toBe("Previous version");
    expect(outputLabel("after")).toBe("Updated version");
  });

  it("leaves an output it does not know alone", () => {
    expect(outputLabel("releasedBy")).toBe("releasedBy");
  });
});

describe("describeValueType", () => {
  it("calls an entity a record, in the catalog's words", () => {
    expect(
      describeValueType(
        { kind: "entity", of: "purchaseOrder" },
        "Purchase order"
      )
    ).toBe("Purchase order record");
  });

  it("falls back to the entity id when no label is supplied", () => {
    expect(describeValueType({ kind: "entity", of: "purchaseOrder" })).toBe(
      "purchaseOrder record"
    );
  });

  it("pluralises inside a list of records", () => {
    expect(
      describeValueType(
        { kind: "list", of: { kind: "entity", of: "job" } },
        "Job"
      )
    ).toBe("a list of Job records");
  });

  it("leaves primitives as plain words", () => {
    expect(describeValueType({ kind: "primitive", of: "string" })).toBe("text");
    expect(describeValueType({ kind: "primitive", of: "date" })).toBe("a date");
  });
});

describe("nodeTitle", () => {
  it("uses the name the user typed", () => {
    expect(nodeTitle("flag_large_po", "Create an issue")).toBe("Flag Large Po");
  });

  it("falls back for an untouched auto-generated name", () => {
    expect(nodeTitle("action_0", "Create an issue")).toBe("Create an issue");
    expect(nodeTitle("trigger_12", "A purchase order is created")).toBe(
      "A purchase order is created"
    );
  });

  it("falls back for a missing or empty name", () => {
    expect(nodeTitle(undefined, "Only if")).toBe("Only if");
    expect(nodeTitle("", "Only if")).toBe("Only if");
  });
});

describe("isDefaultNodeName", () => {
  it("recognises every auto-generated prefix", () => {
    for (const kind of [
      "trigger",
      "action",
      "condition",
      "compute",
      // The old spelling of `compute`. Saved workflows still carry these names.
      "entity",
      "lookup",
      "filter"
    ]) {
      expect(isDefaultNodeName(`${kind}_0`)).toBe(true);
    }
    expect(isDefaultNodeName("flag_large_po")).toBe(false);
    expect(isDefaultNodeName("action_zero")).toBe(false);
  });
});
