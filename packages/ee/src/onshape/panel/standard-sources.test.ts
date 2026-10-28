// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { missingBomColumnsMessage, parseBomTree } from "./bom";
import type { PropertyMapEntry } from "./properties";
import { resolveMappedFields } from "./properties";
import {
  bomColumnIds,
  chosenBomColumn,
  DEFAULT_STANDARD_SOURCES,
  identityValue,
  isIdentityProperty,
  namedColumnId,
  ONSHAPE_PROPERTIES,
  onshapePropertyField,
  releaseSources,
  standardSourceErrors,
  standardSources,
  withIdentitySources
} from "./standard-sources";

const P = ONSHAPE_PROPERTIES;
const ERP_NUMBER_ID = "6a1c00000000000000000001";

/** Onshape's BOM header shape: the property id, `propertyName` and a label. */
function headers(labels: {
  item: string;
  quantity: string;
  partNumber: string;
  revision: string;
  name: string;
  description: string;
  bomBehavior: string;
}) {
  return [
    { id: P.item.propertyId, name: labels.item, propertyName: "item" },
    {
      id: P.quantity.propertyId,
      name: labels.quantity,
      propertyName: "quantity"
    },
    {
      id: P.partNumber.propertyId,
      name: labels.partNumber,
      propertyName: "partNumber"
    },
    {
      id: P.revision.propertyId,
      name: labels.revision,
      propertyName: "revision"
    },
    { id: P.name.propertyId, name: labels.name, propertyName: "name" },
    {
      id: P.description.propertyId,
      name: labels.description,
      propertyName: "description"
    },
    {
      id: P.bomBehavior.propertyId,
      name: labels.bomBehavior,
      propertyName: "bomBehavior"
    },
    // A custom property: its id is its property name.
    { id: ERP_NUMBER_ID, name: "ERP number", propertyName: ERP_NUMBER_ID }
  ];
}

const LABEL_SETS = {
  default: {
    item: "Item",
    quantity: "Quantity",
    partNumber: "Part number",
    revision: "Revision",
    name: "Name",
    description: "Description",
    bomBehavior: "Subassembly BOM behavior"
  },
  allCaps: {
    item: "ITEM",
    quantity: "QUANTITY",
    partNumber: "PART NUMBER",
    revision: "REVISION",
    name: "NAME",
    description: "DESCRIPTION",
    bomBehavior: "SUBASSEMBLY BOM BEHAVIOR"
  },
  renamed: {
    item: "Pos.",
    quantity: "Menge",
    partNumber: "Teilenummer",
    revision: "Rev.",
    name: "Benennung",
    description: "Beschreibung",
    bomBehavior: "Verhalten"
  }
};

function row(cells: {
  item: string;
  quantity: number;
  partNumber: string | null;
  erpNumber?: string;
  behavior?: string;
}) {
  return {
    headerIdToValue: {
      [P.item.propertyId]: cells.item,
      [P.quantity.propertyId]: cells.quantity,
      [P.partNumber.propertyId]: cells.partNumber,
      [P.revision.propertyId]: "B",
      [P.name.propertyId]: `Name ${cells.item}`,
      [P.description.propertyId]: `Description ${cells.item}`,
      [P.bomBehavior.propertyId]: cells.behavior ?? "Default",
      [ERP_NUMBER_ID]: cells.erpNumber ?? null
    }
  };
}

const ROWS = [
  row({ item: "0", quantity: 1, partNumber: "ASM-100", erpNumber: "E-100" }),
  row({
    item: "1",
    quantity: 2,
    partNumber: "SUB-200",
    erpNumber: "E-200",
    behavior: "Show assembly only"
  }),
  row({ item: "1.1", quantity: 3, partNumber: "PRT-300", erpNumber: "E-300" }),
  row({ item: "2", quantity: 4, partNumber: "PRT-400", erpNumber: "E-400" })
];

function entry(
  overrides: Partial<PropertyMapEntry> & Pick<PropertyMapEntry, "target">
): PropertyMapEntry {
  return {
    onshapePropertyId: ERP_NUMBER_ID,
    onshapeName: "ERP number",
    valueType: "STRING",
    mode: "create",
    ...overrides
  };
}

describe("bomColumnIds and parseBomTree", () => {
  for (const [set, labels] of Object.entries(LABEL_SETS)) {
    it(`reads Onshape's own columns under ${set} labels`, () => {
      const bom = { headers: headers(labels), rows: ROWS };
      expect(bomColumnIds(bom.headers)).toEqual({
        item: P.item.propertyId,
        quantity: P.quantity.propertyId,
        partNumber: P.partNumber.propertyId,
        revision: P.revision.propertyId,
        name: P.name.propertyId,
        description: P.description.propertyId,
        bomBehavior: P.bomBehavior.propertyId
      });

      const { root, lines, missingColumns } = parseBomTree(bom);
      expect(missingColumns).toEqual([]);
      expect(root?.partNumber).toBe("ASM-100");
      expect(lines.map((line) => [line.partNumber, line.quantity])).toEqual([
        ["SUB-200", 2],
        ["PRT-400", 4]
      ]);
      expect(lines[0]).toMatchObject({
        revision: "B",
        name: "Name 1",
        description: "Description 1",
        shownAsUnit: true
      });
      expect(lines[0]?.children.map((child) => child.partNumber)).toEqual([
        "PRT-300"
      ]);
    });
  }

  it("finds a column by id when the response has no propertyName", () => {
    const bare = headers(LABEL_SETS.renamed).map(({ id, name }) => ({
      id,
      name
    }));
    expect(bomColumnIds(bare).partNumber).toBe(P.partNumber.propertyId);
    expect(bomColumnIds(bare).quantity).toBe(P.quantity.propertyId);
  });

  it("prefers the exact default label when neither column has an id or propertyName", () => {
    const ids = bomColumnIds([
      { id: "h-custom", name: "PART NUMBER" },
      { id: "h-pn", name: "Part number" }
    ]);
    expect(ids.partNumber).toBe("h-pn");
  });

  it("matches a default label in any case when it is the only one", () => {
    const ids = bomColumnIds([{ id: "h-pn", name: "PART NUMBER" }]);
    expect(ids.partNumber).toBe("h-pn");
  });

  it("reads the part number from the property the map names", () => {
    const sources = standardSources([
      entry({ target: { kind: "identity", field: "partNumber" } })
    ]);
    const { root, lines } = parseBomTree(
      { headers: headers(LABEL_SETS.default), rows: ROWS },
      sources
    );
    expect(root?.partNumber).toBe("E-100");
    expect(lines.map((line) => line.partNumber)).toEqual(["E-200", "E-400"]);
  });

  it("finds an overridden column by its label when its id differs", () => {
    const sources = standardSources([
      entry({ target: { kind: "identity", field: "partNumber" } })
    ]);
    const relabelled = headers(LABEL_SETS.default).map((header) =>
      header.id === ERP_NUMBER_ID
        ? { ...header, id: "col-erp", name: "ERP NUMBER" }
        : header
    );
    expect(bomColumnIds(relabelled, sources).partNumber).toBe("col-erp");
  });

  it("reports an overridden part number column the BOM lacks by its name", () => {
    const sources = standardSources([
      entry({ target: { kind: "identity", field: "partNumber" } })
    ]);
    const withoutErp = headers(LABEL_SETS.default).filter(
      (header) => header.id !== ERP_NUMBER_ID
    );
    const { missingColumns } = parseBomTree(
      { headers: withoutErp, rows: ROWS },
      sources
    );
    expect(missingColumns).toEqual(["ERP number"]);
  });

  it("reads Item and Quantity from the columns the map names", () => {
    const custom = [
      { id: "col-pos", name: "Position", propertyName: "col-pos" },
      { id: "col-count", name: "Count", propertyName: "col-count" },
      {
        id: P.partNumber.propertyId,
        name: "Part number",
        propertyName: "partNumber"
      }
    ];
    const rows = [
      {
        headerIdToValue: {
          "col-pos": "1",
          "col-count": 5,
          [P.partNumber.propertyId]: "PRT-1"
        }
      }
    ];
    expect(parseBomTree({ headers: custom, rows }).missingColumns).toEqual([
      "Item",
      "Quantity"
    ]);

    const sources = standardSources([
      entry({
        onshapePropertyId: "col-pos",
        onshapeName: "Position",
        target: { kind: "bomLine", field: "item" }
      }),
      entry({
        onshapePropertyId: "col-count",
        onshapeName: "Count",
        target: { kind: "bomLine", field: "quantity" }
      })
    ]);
    const { lines, missingColumns } = parseBomTree(
      { headers: custom, rows },
      sources
    );
    expect(missingColumns).toEqual([]);
    expect(lines.map((line) => [line.index, line.quantity])).toEqual([
      ["1", 5]
    ]);
  });

  it("falls back to Onshape's own column when an Item override's column is gone", () => {
    const sources = standardSources([
      entry({
        onshapePropertyId: "col-gone",
        onshapeName: "Position",
        target: { kind: "bomLine", field: "item" }
      })
    ]);
    expect(bomColumnIds(headers(LABEL_SETS.allCaps), sources).item).toBe(
      P.item.propertyId
    );
  });

  it("takes the last of two columns with one label, as before overrides", () => {
    const columns = [
      { id: "col-a", name: "Item", propertyName: "col-a" },
      { id: "col-b", name: "Item", propertyName: "col-b" },
      { id: "col-c", name: "QUANTITY", propertyName: "col-c" },
      { id: "col-d", name: "quantity", propertyName: "col-d" }
    ];
    const ids = bomColumnIds(columns);
    expect(ids.item).toBe("col-b");
    expect(ids.quantity).toBe("col-d");
  });

  it("reads a typed Item column by its name in any case", () => {
    // A template whose item numbers live in a custom column, with Onshape's
    // own Item column removed.
    const custom = [
      { id: "col-list", name: "ITEM List", propertyName: "col-list" },
      {
        id: P.quantity.propertyId,
        name: "Quantity",
        propertyName: "quantity"
      },
      {
        id: P.partNumber.propertyId,
        name: "Part number",
        propertyName: "partNumber"
      }
    ];
    const rows = [
      {
        headerIdToValue: {
          "col-list": "1",
          [P.quantity.propertyId]: 2,
          [P.partNumber.propertyId]: "PRT-1"
        }
      }
    ];
    expect(parseBomTree({ headers: custom, rows }).missingColumns).toEqual([
      "Item"
    ]);
    const sources = standardSources([
      entry({
        onshapePropertyId: namedColumnId(" item list "),
        onshapeName: " item list ",
        target: { kind: "bomLine", field: "item" }
      })
    ]);
    const { lines, missingColumns } = parseBomTree(
      { headers: custom, rows },
      sources
    );
    expect(missingColumns).toEqual([]);
    expect(lines.map((line) => [line.index, line.quantity])).toEqual([
      ["1", 2]
    ]);
  });

  it("finds a chosen column by name on a BOM where its id differs", () => {
    const sources = standardSources([
      entry({
        onshapePropertyId: "col-on-another-template",
        onshapeName: "Position",
        target: { kind: "bomLine", field: "item" }
      })
    ]);
    const columns = [
      ...headers(LABEL_SETS.default),
      { id: "col-pos", name: "position", propertyName: "col-pos" }
    ];
    expect(bomColumnIds(columns, sources).item).toBe("col-pos");
  });

  it("reads a chosen column over Onshape's own, hidden or not", () => {
    const sources = standardSources([
      entry({
        onshapePropertyId: "col-list",
        onshapeName: "ITEM List",
        target: { kind: "bomLine", field: "item" }
      })
    ]);
    const columns = [
      ...headers(LABEL_SETS.default),
      { id: "col-list", name: "ITEM List", propertyName: "col-list" }
    ];
    expect(bomColumnIds(columns).item).toBe(P.item.propertyId);
    expect(bomColumnIds(columns, sources).item).toBe("col-list");
  });

  it("never matches a typed name to another of Onshape's own columns", () => {
    // "Qty" is Onshape's Quantity, relabelled: Item must not read it.
    const columns = headers({ ...LABEL_SETS.default, quantity: "Qty" });
    expect(
      chosenBomColumn(columns, { headerId: namedColumnId("Qty"), name: "Qty" })
    ).toBeNull();
    expect(
      chosenBomColumn(columns, { headerId: P.quantity.propertyId, name: "" })
    ).toBe(P.quantity.propertyId);
  });

  it("names the Fields page in the missing-columns message", () => {
    expect(missingBomColumnsMessage(["Item", "Quantity"])).toContain(
      "on the Fields page"
    );
  });
});

describe("identityValue", () => {
  const metadata = [
    {
      propertyId: P.partNumber.propertyId,
      name: "Teilenummer",
      value: "PRT-1"
    },
    { propertyId: P.name.propertyId, name: "NAME", value: " Bracket " },
    { propertyId: ERP_NUMBER_ID, name: "ERP number", value: "E-1" }
  ];

  it("keeps surrounding spaces when asked, as an assembly's root was read", () => {
    expect(identityValue(metadata, "name")).toBe("Bracket");
    expect(
      identityValue(metadata, "name", DEFAULT_STANDARD_SOURCES, {
        trim: false
      })
    ).toBe(" Bracket ");
  });

  it("reads Onshape's own property by id, whatever its label", () => {
    expect(identityValue(metadata, "partNumber")).toBe("PRT-1");
    expect(identityValue(metadata, "name")).toBe("Bracket");
    expect(identityValue(metadata, "revision")).toBeNull();
  });

  it("falls back to the default label in any case", () => {
    expect(
      identityValue(
        [{ propertyId: "x", name: "PART NUMBER", value: "P" }],
        "partNumber"
      )
    ).toBe("P");
  });

  it("reads an override and never falls back from it", () => {
    const sources = standardSources([
      entry({ target: { kind: "identity", field: "partNumber" } })
    ]);
    expect(identityValue(metadata, "partNumber", sources)).toBe("E-1");
    expect(
      identityValue(metadata.slice(0, 2), "partNumber", sources)
    ).toBeNull();
  });
});

describe("standardSources", () => {
  it("collects identity and BOM line overrides and ignores other targets", () => {
    const sources = standardSources([
      entry({ target: { kind: "identity", field: "revision" } }),
      entry({
        onshapePropertyId: "col-count",
        onshapeName: "Count",
        target: { kind: "bomLine", field: "quantity" }
      }),
      entry({
        onshapePropertyId: "p-mpn",
        target: { kind: "item", field: "mpn" }
      })
    ]);
    expect(sources).toEqual({
      identity: {
        revision: { propertyId: ERP_NUMBER_ID, name: "ERP number" }
      },
      bomLine: { quantity: { headerId: "col-count", name: "Count" } }
    });
  });

  it("keeps Onshape's Part number and Revision for releases", () => {
    const sources = standardSources([
      entry({ target: { kind: "identity", field: "partNumber" } }),
      entry({
        onshapePropertyId: "p-title",
        target: { kind: "identity", field: "name" }
      })
    ]);
    expect(releaseSources(sources).identity).toEqual({
      name: { propertyId: "p-title", name: "ERP number" }
    });
  });
});

describe("onshapePropertyField", () => {
  it("knows Onshape's own properties by id, property name and label", () => {
    expect(onshapePropertyField({ propertyId: P.state.propertyId })).toBe(
      "state"
    );
    expect(
      onshapePropertyField({ id: "h-1", propertyName: "excludeFromBom" })
    ).toBe("excludeFromBom");
    expect(onshapePropertyField({ name: "  NOT REVISION MANAGED " })).toBe(
      "notRevisionManaged"
    );
    expect(onshapePropertyField({ propertyId: ERP_NUMBER_ID })).toBeNull();
    expect(isIdentityProperty({ propertyId: P.description.propertyId })).toBe(
      true
    );
    expect(isIdentityProperty({ propertyId: P.state.propertyId })).toBe(false);
  });
});

describe("withIdentitySources", () => {
  const parts = [
    {
      partId: "JHD",
      name: "Bracket",
      partNumber: "PRT-1",
      revision: "A",
      description: null
    }
  ];

  it("leaves the parts API's values alone with no override", () => {
    expect(
      withIdentitySources(parts, new Map(), DEFAULT_STANDARD_SOURCES)
    ).toEqual(parts);
  });

  it("replaces an overridden value, empty included", () => {
    const sources = standardSources([
      entry({ target: { kind: "identity", field: "partNumber" } })
    ]);
    expect(
      withIdentitySources(
        parts,
        new Map([
          [
            "JHD",
            [{ propertyId: ERP_NUMBER_ID, name: "ERP number", value: "E-1" }]
          ]
        ]),
        sources
      )[0]
    ).toMatchObject({ partNumber: "E-1", revision: "A", name: "Bracket" });
    expect(withIdentitySources(parts, new Map(), sources)[0]?.partNumber).toBe(
      null
    );
  });
});

describe("resolveMappedFields with standard sources", () => {
  it("writes no field for an identity source and does not list it as unmapped", () => {
    const resolved = resolveMappedFields({
      properties: [
        {
          propertyId: ERP_NUMBER_ID,
          name: "ERP number",
          valueType: "STRING",
          value: "E-1"
        },
        {
          propertyId: P.state.propertyId,
          name: "STATE",
          valueType: "ENUM",
          value: "Released"
        }
      ],
      map: [entry({ target: { kind: "identity", field: "partNumber" } })],
      definitions: []
    });
    expect(resolved).toEqual({
      fields: [],
      itemFields: [],
      problems: [],
      unmapped: []
    });
  });
});

describe("standardSourceErrors", () => {
  it("takes a text or list property for an identity field", () => {
    expect(
      standardSourceErrors(
        entry({ target: { kind: "identity", field: "partNumber" } })
      )
    ).toEqual([]);
    expect(
      standardSourceErrors(
        entry({
          valueType: "ENUM",
          target: { kind: "identity", field: "name" }
        })
      )
    ).toEqual([]);
  });

  it("refuses another type and another of Onshape's own properties", () => {
    expect(
      standardSourceErrors(
        entry({
          valueType: "DOUBLE",
          target: { kind: "identity", field: "revision" }
        })
      )
    ).toEqual(["Revision is read from a text or list property, not DOUBLE."]);
    expect(
      standardSourceErrors(
        entry({
          onshapePropertyId: P.description.propertyId,
          target: { kind: "identity", field: "name" }
        })
      )
    ).toEqual([
      "That is Onshape's Description. Choose the property that holds Name."
    ]);
  });

  it("takes any BOM column for Item or Quantity but Onshape's other columns", () => {
    expect(
      standardSourceErrors(
        entry({
          onshapePropertyId: "col-count",
          valueType: "DOUBLE",
          target: { kind: "bomLine", field: "quantity" }
        })
      )
    ).toEqual([]);
    expect(
      standardSourceErrors(
        entry({
          onshapePropertyId: P.partNumber.propertyId,
          target: { kind: "bomLine", field: "item" }
        })
      )
    ).toEqual([
      "That is Onshape's Part number. Choose the column that holds Item."
    ]);
  });

  it("takes a typed column name unless it is another of Onshape's own", () => {
    const typed = (name: string, field: "item" | "quantity") =>
      standardSourceErrors(
        entry({
          onshapePropertyId: namedColumnId(name),
          onshapeName: name,
          target: { kind: "bomLine", field }
        })
      );
    expect(typed("ITEM List", "item")).toEqual([]);
    expect(typed("item", "item")).toEqual([]);
    expect(typed(" QUANTITY ", "item")).toEqual([
      "That is Onshape's Quantity. Choose the column that holds Item."
    ]);
    expect(typed("  ", "quantity")).toEqual([
      "Type the name of the column that holds Quantity."
    ]);
  });

  it("has nothing to say about other targets", () => {
    expect(
      standardSourceErrors(
        entry({ valueType: "BLOB", target: { kind: "item", field: "mpn" } })
      )
    ).toEqual([]);
  });
});
