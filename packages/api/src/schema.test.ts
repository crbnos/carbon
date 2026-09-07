// The input validator is the only thing between a caller and the dispatcher's
// positional assembly. It has to reject genuinely malformed payloads without
// rejecting the shapes dispatch already accepts — MCP, the in-app agent and the
// workflow engine all run through the same procedure as HTTP.

import { describe, expect, it } from "vitest";
import { jsonSchema, jsonSchemaInput } from "./schema";

function validate(schema: Record<string, unknown>, value: unknown) {
  return jsonSchemaInput(schema)["~standard"].validate(value) as {
    value?: unknown;
    issues?: readonly { message: string }[];
  };
}

const DELETE_API_KEY = {
  type: "object",
  properties: { id: { type: "string" } },
  required: ["id"]
};

describe("jsonSchemaInput", () => {
  it("rejects a payload missing a required scalar", () => {
    // The real defect: `{ apiKeyId }` against `required: ["id"]` reached the
    // dispatcher, which passed the whole object as the `id` positional. The
    // delete matched nothing and returned 200 null.
    const r = validate(DELETE_API_KEY, { apiKeyId: "api_1" });
    expect(r.issues).toBeDefined();
    expect(r.value).toBeUndefined();
  });

  it("accepts the payload the schema declares", () => {
    const r = validate(DELETE_API_KEY, { id: "api_1" });
    expect(r.issues).toBeUndefined();
    expect(r.value).toEqual({ id: "api_1" });
  });

  it("preserves unknown keys instead of stripping them", () => {
    // No generated schema sets additionalProperties:false, and the dispatcher's
    // positional fallbacks read keys the schema never declared. Stripping here
    // would silently empty those payloads.
    const r = validate(DELETE_API_KEY, { id: "api_1", extra: "keep" });
    expect(r.value).toEqual({ id: "api_1", extra: "keep" });
  });

  it("applies declared defaults", () => {
    const r = validate(
      {
        type: "object",
        properties: {
          limit: { type: "integer", default: 100 },
          search: { type: "string" }
        }
      },
      { search: "x" }
    );
    expect(r.value).toEqual({ search: "x", limit: 100 });
  });

  it("accepts a sole wrapper's contents sent flat", () => {
    // job.create sends { itemId, quantity } to production_insertJob, whose
    // schema declares an `input` wrapper. Rejecting it would break every
    // published job-create workflow.
    const schema = {
      type: "object",
      properties: {
        input: {
          type: "object",
          properties: {
            itemId: { type: "string" },
            quantity: { type: "number" }
          },
          required: ["itemId", "quantity"]
        },
        options: { type: "object", properties: {} }
      },
      required: ["input"]
    };
    expect(
      validate(schema, { itemId: "i1", quantity: 5 }).issues
    ).toBeUndefined();
    expect(
      validate(schema, { input: { itemId: "i1", quantity: 5 } }).issues
    ).toBeUndefined();
    // Still rejected — neither shape carries the wrapper's required fields.
    expect(validate(schema, {}).issues).toBeDefined();
  });

  it("keeps checking an operation that requires more than the wrapper", () => {
    const schema = {
      type: "object",
      properties: {
        data: { type: "object", properties: {} },
        id: { type: "string" }
      },
      required: ["data", "id"]
    };
    expect(validate(schema, { lines: [] }).issues).toBeDefined();
  });

  it("falls back to pass-through when the schema cannot be converted", () => {
    const r = validate({ type: "object", $ref: "#/nope/missing" }, { any: 1 });
    expect(r.issues).toBeUndefined();
  });
});

describe("jsonSchema (the output wrapper)", () => {
  it("never rejects — shapeHttpBody rewrites the body, so responses do not match", () => {
    const r = jsonSchema({
      type: "object",
      required: ["absent"]
    })["~standard"].validate({ anything: true }) as { value?: unknown };
    expect(r.value).toEqual({ anything: true });
  });
});
