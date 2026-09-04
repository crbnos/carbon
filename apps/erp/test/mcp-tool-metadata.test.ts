import { describe, expect, it } from "vitest";
import metadata from "../app/routes/api+/mcp+/lib/tool-metadata.json";

// Regression guards for the MCP tool-metadata generator (scripts/generate-mcp.ts).
// These encode the shape bugs reported against the quote-setup tools AND the
// general classes they belong to, so a future generator change that reintroduces
// any of them fails here instead of silently in a customer's MCP session.

type Tool = {
  name: string;
  classification: "READ" | "WRITE" | "DESTRUCTIVE";
  serviceParams: string[];
  schema: {
    type?: string;
    properties?: Record<string, any>;
    required?: string[];
  };
};

const tools = metadata.tools as Tool[];
const byName = new Map(tools.map((t) => [t.name, t]));
const get = (name: string): Tool => {
  const t = byName.get(name);
  if (!t) throw new Error(`tool ${name} missing from metadata`);
  return t;
};
const props = (t: Tool) => t.schema.properties ?? {};

describe("mcp tool-metadata generator", () => {
  it("totalTools matches the tools array", () => {
    expect(metadata.totalTools).toBe(tools.length);
  });

  // #2 — an array-of-objects service param publishes as an array, not an object.
  it("upsertQuoteLinePrices exposes quoteLinePrices as an array of rows", () => {
    const t = get("sales_upsertQuoteLinePrices");
    const arr = props(t).quoteLinePrices;
    expect(arr?.type).toBe("array");
    expect(arr?.items?.type).toBe("object");
    // createdBy is auth-injected, never a caller field.
    expect(arr?.items?.properties?.createdBy).toBeUndefined();
    expect(Object.keys(arr?.items?.properties ?? {})).toContain("unitPrice");
  });

  // #8 — a delete-and-reinsert write is flagged destructive-by-omission.
  it("upsertQuoteLinePrices is classified DESTRUCTIVE", () => {
    expect(get("sales_upsertQuoteLinePrices").classification).toBe("DESTRUCTIVE");
  });

  // #5 — a validator field after an `errorMap: () => (...)` is not truncated.
  it("upsertQuoteLine still exposes fields that follow an errorMap arrow", () => {
    const p = props(get("sales_upsertQuoteLine"));
    expect(p.quantity?.type).toBe("array");
    for (const field of ["description", "methodType", "unitOfMeasureCode"]) {
      expect(Object.keys(p)).toContain(field);
    }
  });

  // #9 — a `applyX(baseValidator.merge(z.object({...})))` param resolves to real
  // fields instead of an opaque {}. Guard the whole item-validator family.
  it("resolves merge/wrapper validator params to real fields", () => {
    for (const name of [
      "items_upsertService",
      "items_upsertConsumable",
      "items_upsertPart",
      "items_upsertMaterial",
      "items_upsertTool"
    ]) {
      const keys = Object.keys(props(get(name)));
      expect(keys.length).toBeGreaterThan(1);
      expect(keys).toContain("name");
    }
  });

  // General: every array-typed property declares its items shape (no bare arrays
  // that leave a caller guessing the element type).
  it("every array-typed schema property has an items definition", () => {
    for (const t of tools) {
      for (const [key, value] of Object.entries(props(t))) {
        if (value && typeof value === "object" && value.type === "array") {
          expect(value.items, `${t.name}.${key}`).toBeDefined();
        }
      }
    }
  });
});
