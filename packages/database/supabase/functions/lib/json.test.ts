import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { toJson, toJsonColumns } from "./json.ts";

// deno-postgres encodes a string parameter as raw text and an array as a
// Postgres array literal, so a JSON column only round-trips object values.
// `toJson` must hand the driver valid JSON TEXT for every shape a json/jsonb
// column can legitimately hold — that is the whole contract.

Deno.test("toJson: object is serialised as JSON text", () => {
  assertEquals(
    toJson({ type: "doc", content: [] }),
    '{"type":"doc","content":[]}'
  );
});

Deno.test("toJson: a JSON string scalar is quoted, not sent raw", () => {
  // Raw `some text` is what deno-postgres would otherwise send; Postgres
  // rejects it with `invalid input syntax for type json`.
  assertEquals(toJson("some text"), '"some text"');
  assertEquals(toJson(""), '""');
});

Deno.test("toJson: an array is JSON, not a Postgres array literal", () => {
  assertEquals(toJson(["a", "b"]), '["a","b"]');
});

Deno.test("toJson: numbers and booleans are JSON scalars", () => {
  assertEquals(toJson(1.5), "1.5");
  assertEquals(toJson(false), "false");
});

Deno.test("toJson: null and undefined pass through untouched", () => {
  // null must stay NULL (not the JSON text "null"), and undefined must stay
  // absent so Kysely omits the column and the DEFAULT applies.
  assertEquals(toJson(null), null);
  assertEquals(toJson(undefined), undefined);
});

Deno.test("toJson: output always parses back to the input", () => {
  for (const value of [{ a: 1 }, "x", ["y"], 0, true]) {
    assertEquals(JSON.parse(toJson(value) as string), value);
  }
});

// toJsonColumns is what a document copy (quoteToQuote's per-line copy in
// get-method/index.ts) runs a source row through before spreading it into a
// Kysely insert. This pins the exact regression: a quoteLine whose
// jsonb columns were ever written as a bare string/array (legacy data, or an
// API path typed `z.any()`) must still copy cleanly instead of failing the
// whole quote duplication with "invalid input syntax for type json".
Deno.test("toJsonColumns: serialises only the named columns, leaving the rest of the row untouched", () => {
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
  assertEquals(result.additionalCharges, '["legacy-array-instead-of-object"]');
  assertEquals(result.configuration, '"legacy-string-instead-of-object"');
  assertEquals(result.customFields, '{"color":"red"}');
  assertEquals(result.externalNotes, '"a plain string note"');
  assertEquals(result.internalNotes, null);
  assertEquals(
    JSON.parse(result.priceTrace as string),
    line.priceTrace
  );

  // Columns not named in the list are untouched by the call, so spreading
  // `{ ...line, ...toJsonColumns(line, [...]) }` only overrides what's named.
  assertEquals("id" in result, false);
  assertEquals("description" in result, false);
});

Deno.test("toJsonColumns: an already-clean object column round-trips unchanged in meaning", () => {
  const line = { customFields: { a: 1, b: [2, 3] } };
  const result = toJsonColumns(line, ["customFields"] as const);
  assertEquals(JSON.parse(result.customFields as string), line.customFields);
});
