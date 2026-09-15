import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { toJson } from "./json.ts";

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
