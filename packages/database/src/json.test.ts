// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { toJson, toJsonColumns } from "./json.ts";

// deno-postgres encodes a string parameter as raw text and an array as a
// Postgres array literal, so a JSON column only round-trips object values.
// `toJson` must hand the driver valid JSON TEXT for every shape a json/jsonb
// column can legitimately hold — that is the whole contract.

it("toJson: object is serialised as JSON text", () => {
  expect(toJson({ type: "doc", content: [] })).toEqual(
    '{"type":"doc","content":[]}'
  );
});

it("toJson: a JSON string scalar is quoted, not sent raw", () => {
  // Raw `some text` is what deno-postgres would otherwise send; Postgres
  // rejects it with `invalid input syntax for type json`.
  expect(toJson("some text")).toEqual('"some text"');
  expect(toJson("")).toEqual('""');
});

it("toJson: an array is JSON, not a Postgres array literal", () => {
  expect(toJson(["a", "b"])).toEqual('["a","b"]');
});

it("toJson: numbers and booleans are JSON scalars", () => {
  expect(toJson(1.5)).toEqual("1.5");
  expect(toJson(false)).toEqual("false");
});

it("toJson: null and undefined pass through untouched", () => {
  // null must stay NULL (not the JSON text "null"), and undefined must stay
  // absent so Kysely omits the column and the DEFAULT applies.
  expect(toJson(null)).toEqual(null);
  expect(toJson(undefined)).toEqual(undefined);
});

it("toJson: output always parses back to the input", () => {
  for (const value of [{ a: 1 }, "x", ["y"], 0, true]) {
    expect(JSON.parse(toJson(value) as string)).toEqual(value);
  }
});

// toJsonColumns is what a document copy (quoteToQuote's per-line copy in
// get-method/index.ts) runs a source row through before spreading it into a
// Kysely insert. This pins the exact regression: a quoteLine whose
// jsonb columns were ever written as a bare string/array (legacy data, or an
// API path typed `z.any()`) must still copy cleanly instead of failing the
// whole quote duplication with "invalid input syntax for type json".
it("toJsonColumns: serialises only the named columns, leaving the rest of the row untouched", () => {
  const line = {
    id: "qtl_1",
    quoteId: "qt_1",
    description: "A widget",
    additionalCharges: ["legacy-array-instead-of-object"],
    configuration: "legacy-string-instead-of-object",
    customFields: { color: "red" },
    externalNotes: "a plain string note",
    internalNotes: null as unknown,
    priceTrace: [{ step: "Markup", source: "Rule: x", amount: 12.5 }]
  };

  const result = toJsonColumns(line, [
    "additionalCharges",
    "configuration",
    "customFields",
    "externalNotes",
    "internalNotes",
    "priceTrace"
  ] as const);

  // Every named column comes back as valid JSON TEXT, regardless of the
  // shape it was stored in — an array, a bare string, an object, or null.
  expect(result.additionalCharges).toEqual(
    '["legacy-array-instead-of-object"]'
  );
  expect(result.configuration).toEqual('"legacy-string-instead-of-object"');
  expect(result.customFields).toEqual('{"color":"red"}');
  expect(result.externalNotes).toEqual('"a plain string note"');
  expect(result.internalNotes).toEqual(null);
  expect(JSON.parse(result.priceTrace as string)).toEqual(line.priceTrace);

  // Columns not named in the list are untouched by the call, so spreading
  // `{ ...line, ...toJsonColumns(line, [...]) }` only overrides what's named.
  expect("id" in result).toEqual(false);
  expect("description" in result).toEqual(false);
});

it("toJsonColumns: an already-clean object column round-trips unchanged in meaning", () => {
  const line = { customFields: { a: 1, b: [2, 3] } };
  const result = toJsonColumns(line, ["customFields"] as const);
  expect(JSON.parse(result.customFields as string)).toEqual(line.customFields);
});
