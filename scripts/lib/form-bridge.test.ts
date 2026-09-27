// Generator side of the API form bridge: which validator fields become
// coercers, and which defaults an update-capable tool stops publishing.
// Run: npx tsx --test scripts/lib/form-bridge.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { extractFieldCoercers, stripUpdateDefaults } from "./service-metadata";
import {
  COERCE_MARKER,
  validatorToJsonSchema,
} from "./validator-to-json-schema";

const toDoc = (value: string) => ({ type: "doc", text: value });

const source = { module: "demo", validator: "stepValidator" };

describe("validatorToJsonSchema transform marks", () => {
  const stepValidator = z.object({
    name: z.string(),
    description: z.string().transform((v) => toDoc(v)),
    notes: z
      .union([z.string(), z.record(z.string(), z.unknown())])
      .transform((v) => v)
      .optional(),
    required: zfd.checkbox(),
    quantity: zfd.numeric(z.number().optional()),
    sortOrder: z.number().default(0),
    rows: z.array(
      z.object({
        tracked: zfd.text(z.string().transform((v) => v === "true")),
      })
    ),
  });
  const schema = validatorToJsonSchema(stepValidator, source);
  const props = schema.properties as Record<string, Record<string, unknown>>;

  it("marks a field whose output differs from its input", () => {
    assert.deepEqual(props.description[COERCE_MARKER], {
      ...source,
      field: ["description"],
    });
    assert.ok(props.notes[COERCE_MARKER]);
  });

  it("marks a transform inside array rows with a `*` path", () => {
    const items = (props.rows.items as Record<string, unknown>)
      .properties as Record<string, Record<string, unknown>>;
    assert.deepEqual(items.tracked[COERCE_MARKER], {
      ...source,
      field: ["rows", "*", "tracked"],
    });
  });

  it("does not mark a plain field, a default, a checkbox or a numeric preprocess", () => {
    for (const key of ["name", "required", "quantity", "sortOrder"]) {
      assert.equal(props[key][COERCE_MARKER], undefined, key);
    }
  });

  it("marks a standalone field validator on its root, never an object validator", () => {
    const standalone = validatorToJsonSchema(
      z.string().transform((v) => toDoc(v)).optional(),
      { module: "shared", validator: "optionalDoc" }
    );
    assert.deepEqual(standalone[COERCE_MARKER], {
      module: "shared",
      validator: "optionalDoc",
      field: [],
    });
    const wholeObject = validatorToJsonSchema(
      z.object({ a: z.string() }).transform((v) => v),
      source
    );
    assert.equal(wholeObject[COERCE_MARKER], undefined);
  });
});

describe("extractFieldCoercers", () => {
  it("lifts marks into input paths and deletes them from the schema", () => {
    const schema = {
      type: "object",
      properties: {
        description: {
          type: "string",
          [COERCE_MARKER]: { module: "m", validator: "v", field: ["description"] },
        },
        job: {
          type: "object",
          properties: {
            notes: {
              anyOf: [{ type: "string" }, { type: "null" }],
              [COERCE_MARKER]: { module: "shared", validator: "d", field: [] },
            },
          },
        },
      },
      [COERCE_MARKER]: { module: "m", validator: "whole", field: [] },
    };
    const coercers = extractFieldCoercers(schema);
    assert.deepEqual(coercers, [
      { at: ["description"], module: "m", validator: "v", field: ["description"] },
      { at: ["job", "notes"], module: "shared", validator: "d", field: [] },
    ]);
    assert.equal(JSON.stringify(schema).includes(COERCE_MARKER), false);
  });
});

describe("stripUpdateDefaults", () => {
  it("removes defaults on property chains and returns the top-level ones", () => {
    const schema = {
      type: "object",
      properties: {
        taxExempt: { type: "boolean", default: false },
        data: {
          type: "object",
          properties: { priority: { type: "integer", default: 0 } },
        },
        charges: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: { taxable: { type: "boolean", default: true } },
          },
        },
      },
    };
    assert.deepEqual(stripUpdateDefaults(schema), { taxExempt: false });
    const props = schema.properties as Record<string, Record<string, unknown>>;
    assert.equal("default" in props.taxExempt, false);
    assert.equal(
      "default" in
        (props.data.properties as Record<string, Record<string, unknown>>)
          .priority,
      false
    );
    // A collection element written whole keeps its default.
    assert.equal(
      JSON.stringify(props.charges).includes('"default":true'),
      true
    );
  });
});
