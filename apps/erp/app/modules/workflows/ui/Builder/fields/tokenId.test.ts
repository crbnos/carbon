import { describe, expect, it } from "vitest";
import {
  decodeTokenId,
  encodeTokenId,
  leafOfLabel,
  refLabel,
  refLeafLabel
} from "./tokenId";

describe("token id codec", () => {
  it("round-trips a variable ref", () => {
    const ref = {
      kind: "ref" as const,
      nodeId: "n1",
      output: "record",
      path: ["customer", "name"]
    };
    expect(decodeTokenId(encodeTokenId(ref))).toEqual(ref);
  });

  it("round-trips an item ref", () => {
    const ref = { kind: "item" as const, path: ["id"] };
    expect(decodeTokenId(encodeTokenId(ref))).toEqual(ref);
  });

  it("returns undefined for anything it did not write", () => {
    expect(decodeTokenId("not json")).toBeUndefined();
    expect(decodeTokenId("null")).toBeUndefined();
    expect(decodeTokenId(JSON.stringify({ kind: "ref" }))).toBeUndefined();
    expect(
      decodeTokenId(JSON.stringify({ kind: "text", path: [] }))
    ).toBeUndefined();
    expect(
      decodeTokenId(JSON.stringify({ kind: "item", path: [1] }))
    ).toBeUndefined();
  });
});

describe("refLabel", () => {
  it("shows the node name, not the node id", () => {
    const ref = {
      kind: "ref" as const,
      nodeId: "n1",
      output: "record",
      path: ["customer"]
    };
    expect(refLabel(ref, "when-order-created")).toBe(
      "When Order Created › Record › customer"
    );
  });

  it("falls back to the id when the node is gone", () => {
    const ref = {
      kind: "ref" as const,
      nodeId: "n1",
      output: "record",
      path: []
    };
    expect(refLabel(ref, undefined)).toBe("n1 › Record");
  });

  it("distinguishes two paths off the same output", () => {
    const base = { kind: "ref" as const, nodeId: "n1", output: "record" };
    expect(refLabel({ ...base, path: ["name"] }, "step")).not.toBe(
      refLabel({ ...base, path: ["email"] }, "step")
    );
  });
});

describe("refLeafLabel", () => {
  it("falls back to the output when there is no path", () => {
    expect(
      refLeafLabel({ kind: "ref", nodeId: "n1", output: "record", path: [] })
    ).toBe("Record");
  });

  it("returns the last path segment", () => {
    expect(
      refLeafLabel({
        kind: "ref",
        nodeId: "n1",
        output: "record",
        path: ["customer", "name"]
      })
    ).toBe("name");
  });

  it("names the loop item when an item ref has no path", () => {
    expect(refLeafLabel({ kind: "item", path: [] })).toBe("Current item");
  });

  it("returns the last path segment of an item ref", () => {
    expect(refLeafLabel({ kind: "item", path: ["quantity"] })).toBe("quantity");
  });
});

describe("leafOfLabel", () => {
  it("takes the last segment of a rendered label", () => {
    expect(leafOfLabel("when-order-created › record › customer")).toBe(
      "customer"
    );
  });

  it("returns a single-segment label unchanged", () => {
    expect(leafOfLabel("record")).toBe("record");
  });
});
