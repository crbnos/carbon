// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { enumMappingsForCsv } from "./import-enum-mappings";

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

  it("leaves out a default that is not one of the field's options", () => {
    const { enumMappings } = enumMappingsForCsv(
      "part",
      [{ id: "P-1", readableId: "P-1", name: "Washer" }],
      { id: "id", readableId: "readableId", name: "name" },
      {}
    );
    expect(enumMappings.defaultMethodType).toEqual({});
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
