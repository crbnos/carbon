import { describe, expect, it, vi } from "vitest";

// Stands in for the Lingui macro's compiled output: a generated hash `id` plus the
// real text on `message`. Mocking the module (not the macro) keeps this test honest
// about which field `labelText` reads.
vi.mock("@carbon/workflows/labels", () => ({
  WORKFLOW_LABELS: {
    "purchaseOrder.created": {
      id: "U2ehIB",
      message: "A purchase order is created"
    }
  }
}));

import { humanizeField, labelText } from "./meta";

describe("labelText", () => {
  it("returns the label text, not the generated message id", () => {
    expect(labelText("purchaseOrder.created")).toBe(
      "A purchase order is created"
    );
    expect(labelText("purchaseOrder.created")).not.toBe("U2ehIB");
  });

  it("returns undefined for an unknown key", () => {
    expect(labelText("nope.not.a.key")).toBeUndefined();
  });
});

describe("humanizeField", () => {
  it("turns a camelCase field into a sentence-case label", () => {
    expect(humanizeField("orderTotal")).toBe("Order total");
  });
});
