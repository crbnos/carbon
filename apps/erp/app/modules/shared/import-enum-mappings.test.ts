// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { enumMappingsForCsv, withCsvIdMatches } from "./import-enum-mappings";

describe("enumMappingsForCsv", () => {
  it("fills each enum field's default when the column is absent", () => {
    const { enumMappings, unmatched } = enumMappingsForCsv(
      "process",
      [{ id: "PR-1", name: "Laser cutting" }],
      { id: "id", name: "name" },
      {}
    );
    expect(enumMappings.defaultStandardFactor).toEqual({
      Default: "Hours/Piece"
    });
    expect(enumMappings.processType).toEqual({ Default: "Process" });
    expect(unmatched).toEqual({});
  });

  it("gives a part the part form's default method", () => {
    const { enumMappings } = enumMappingsForCsv(
      "part",
      [{ id: "P-1", readableId: "P-1", name: "Washer" }],
      { id: "id", readableId: "readableId", name: "name" },
      {}
    );
    expect(enumMappings.defaultMethodType).toEqual({
      Default: "Pull from Inventory"
    });
  });

  it("matches values by label in any case and reports the rest", () => {
    const { enumMappings, unmatched } = enumMappingsForCsv(
      "process",
      [
        { id: "PR-1", name: "Laser", type: "assembly" },
        { id: "PR-2", name: "Paint", type: "Painting" },
        { id: "PR-3", name: "Check", type: "" }
      ],
      { id: "id", name: "name", processType: "type" },
      {}
    );
    expect(enumMappings.processType).toEqual({
      Default: "Process",
      assembly: "Assembly"
    });
    expect(unmatched).toEqual({ processType: ["Painting"] });
  });

  it("resolves fetched options by name or id, and given mappings win", () => {
    const { enumMappings, unmatched } = enumMappingsForCsv(
      "part",
      [
        { id: "P-1", uom: "Each" },
        { id: "P-2", uom: "uom_kg" },
        { id: "P-3", uom: "Box" }
      ],
      { id: "id", unitOfMeasureCode: "uom" },
      {
        unitOfMeasureCode: [
          { label: "Each", value: "EA", aliases: ["uom_ea"] },
          { label: "Kilogram", value: "KG", aliases: ["uom_kg"] }
        ]
      },
      { unitOfMeasureCode: { Box: "EA" } }
    );
    expect(enumMappings.unitOfMeasureCode).toMatchObject({
      Each: "EA",
      uom_kg: "KG",
      Box: "EA"
    });
    expect(unmatched).toEqual({});
  });
});

describe("withCsvIdMatches", () => {
  const options = {
    supplierId: [
      { label: "Northwind Metals", value: "sup_1" },
      { label: "Harbor Fasteners", value: "sup_2" }
    ]
  };

  it("resolves an unmatched value by the Unique ID an earlier import stored", () => {
    const result = withCsvIdMatches(
      { supplierId: { "Northwind Metals": "sup_1" } },
      { supplierId: ["S-002", "S-404"] },
      { supplierId: new Map([["S-002", "sup_2"]]) },
      options
    );
    expect(result.enumMappings.supplierId).toEqual({
      "Northwind Metals": "sup_1",
      "S-002": "sup_2"
    });
    expect(result.unmatched).toEqual({ supplierId: ["S-404"] });
  });

  it("ignores a stored id whose record is no longer an option", () => {
    const result = withCsvIdMatches(
      { supplierId: {} },
      { supplierId: ["S-009"] },
      { supplierId: new Map([["S-009", "sup_deleted"]]) },
      options
    );
    expect(result.unmatched).toEqual({ supplierId: ["S-009"] });
  });

  it("leaves fields without Unique ID matches unmatched", () => {
    const result = withCsvIdMatches(
      {},
      { unitOfMeasureCode: ["Crate"] },
      {},
      options
    );
    expect(result.unmatched).toEqual({ unitOfMeasureCode: ["Crate"] });
  });
});
