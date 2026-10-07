// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { importCsvInput } from "@carbon/server-functions/import-csv";
import { describe, expect, it } from "vitest";
import {
  columnMappingsFromHeaders,
  enumDefault,
  fieldMappings,
  importSchemas,
  parseCsvHeader
} from "./imports.models";
import { csvImportTables } from "./shared.models";

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

describe("CSV text import", () => {
  // A table added on one side only would either be refused by the importer or
  // never offered over MCP.
  it("offers exactly the tables the import-csv server function accepts", () => {
    expect([...csvImportTables].sort()).toEqual(
      [...importCsvInput.shape.table.options].sort()
    );
  });

  it("describes every table it offers", () => {
    for (const table of csvImportTables) {
      expect(fieldMappings, table).toHaveProperty(table);
    }
  });

  it("reads a header row, quotes and all", () => {
    expect(parseCsvHeader("id,readableId,name\nP-1,P-1,Frame")).toEqual([
      "id",
      "readableId",
      "name"
    ]);
    expect(
      parseCsvHeader('﻿"Part Number", "Description, long" ,"Say ""hi"""\r\nx')
    ).toEqual(["Part Number", "Description, long", 'Say "hi"']);
    expect(parseCsvHeader("id,,name")).toEqual(["id", "name"]);
  });

  it("maps headers by field key or label and reports the rest", () => {
    expect(
      columnMappingsFromHeaders("part", [
        "id",
        "part number",
        "Description",
        "Colour"
      ])
    ).toEqual({
      columnMappings: {
        id: "id",
        readableId: "part number",
        name: "Description"
      },
      unknownHeaders: ["Colour"]
    });
  });
});

// The wizard sends an enum field's default for every blank or missing cell, so
// a default the importer rejects fails every such row. The Default Method
// defaults read "Make" after the method types were renamed to "Make to Order"
// and its siblings, and every part imported without that column failed.
describe("enum defaults", () => {
  const tables = Object.keys(fieldMappings) as (keyof typeof fieldMappings)[];

  it.each(tables)("%s offers only defaults among its options", (table) => {
    const invalid = Object.entries(
      fieldMappings[table] as Record<
        string,
        {
          type: string;
          enumData?: { options?: readonly string[]; default?: string };
        }
      >
    ).filter(
      ([, field]) =>
        field.type === "enum" &&
        // An empty default means "leave the cell blank".
        Boolean(field.enumData?.default) &&
        enumDefault(field.enumData) === undefined
    );

    expect(invalid.map(([key]) => key)).toEqual([]);
  });

  it("drops a default that is not one of the options", () => {
    expect(enumDefault({ options: ["A", "B"], default: "C" })).toBeUndefined();
    expect(enumDefault({ options: ["A", "B"], default: "B" })).toBe("B");
    expect(enumDefault({ default: "EA" })).toBe("EA");
  });
});
