import { describe, expect, it } from "vitest";
import { fieldMappings, importSchemas } from "./imports.models";

// The import route builds `columnMappings` from `validator(importSchemas[table]
// .extend({...})).validate(formData)`, and a zod object strips keys it does not
// declare. So a field the wizard offers but the schema omits is mapped by the
// user, submitted, and silently dropped before the edge function ever sees it —
// which is how every CSV-imported item landed at revision "0" while the wizard
// marked the Revision column required.
//
// Only this direction is asserted. A schema key with no `fieldMappings` entry is
// inert (nothing submits it), whereas a `fieldMappings` entry with no schema key
// loses data.
describe("importSchemas covers every mappable field", () => {
  const tables = Object.keys(fieldMappings) as (keyof typeof fieldMappings)[];

  it.each(tables)("%s", (table) => {
    const mappable = Object.keys(fieldMappings[table]);
    const declared = new Set(Object.keys(importSchemas[table].shape));
    const dropped = mappable.filter((field) => !declared.has(field));

    expect(dropped).toEqual([]);
  });
});

describe("item revision survives route validation", () => {
  const itemTables = [
    "part",
    "tool",
    "fixture",
    "consumable",
    "material"
  ] as const;

  it.each(itemTables)("%s keeps the mapped Revision column", (table) => {
    const parsed = importSchemas[table].parse({
      id: "EXT-1",
      readableId: "PN-1",
      revision: "B",
      name: "Widget"
    });

    expect(parsed).toHaveProperty("revision", "B");
  });
});
