// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { fieldMappings, importSchemas } from "./imports.models";

// The import route builds `columnMappings` from `validator(importSchemas[table]
// .extend({...})).validate(formData)`, and a zod object strips keys it does not
// declare. So a field the wizard offers but the schema omits is mapped by the
// user, submitted, and silently dropped before the server function ever sees it —
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

// An enum field's `default` presets the wizard's Default row, and the import
// validates it like any other value. A preset that is not one of the options
// refuses every row of a file that has no value for the field.
describe("enum presets are valid options", () => {
  const presets = Object.entries(fieldMappings).flatMap(([table, fields]) =>
    Object.entries(fields).flatMap(([field, mapping]) => {
      const { enumData } = mapping as {
        enumData?: { options?: readonly string[]; default?: string };
      };
      return enumData?.options && enumData.default
        ? [{ name: `${table}.${field}`, ...enumData }]
        : [];
    })
  );

  it.each(presets)("$name", ({ options, default: preset }) => {
    expect(options).toContain(preset);
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
