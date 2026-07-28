/**
 * Regression tests for the MCP tool-metadata generator's type → JSON Schema
 * conversion.
 *
 * Dependency-free (node:test + node:assert). Run with:
 *   npx tsx --test scripts/generate-mcp.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { typeToJsonSchema } from "./generate-mcp";

test("numeric literal union → integer enum", () => {
  assert.deepEqual(typeToJsonSchema("2 | 3 | 4"), {
    type: "integer",
    enum: [2, 3, 4],
  });
});

test("nullable numeric literal union keeps null in both type and enum", () => {
  // Regression: `2 | 3 | null` used to widen `type` to include "null" while
  // leaving `enum` as [2, 3], so validators still rejected null.
  assert.deepEqual(typeToJsonSchema("2 | 3 | null"), {
    type: ["integer", "null"],
    enum: [2, 3, null],
  });
});

test("nullable string literal union keeps null in both type and enum", () => {
  assert.deepEqual(typeToJsonSchema('"a" | "b" | null'), {
    type: ["string", "null"],
    enum: ["a", "b", null],
  });
});

test("nullable primitive without enum only widens the type", () => {
  assert.deepEqual(typeToJsonSchema("string | null"), {
    type: ["string", "null"],
  });
});
