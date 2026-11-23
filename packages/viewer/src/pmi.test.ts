// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  formatPmiItem,
  groupPmiItems,
  type PmiDimension,
  type PmiDocument,
  type PmiItem,
  type PmiTolerance,
  parsePmiDocument,
  pmiInspectionCharacteristics,
  pmiItemBounds,
  pmiViewBounds,
  visibleItemIds
} from "./pmi";

function item(overrides: Partial<PmiItem> & Pick<PmiItem, "id" | "kind">) {
  return {
    name: null,
    dimension: null,
    tolerance: null,
    datum: null,
    lines: [],
    mesh: null,
    plane: null,
    textPosition: null,
    faces: [],
    edges: [],
    ...overrides
  } satisfies PmiItem;
}

function dimension(overrides: Partial<PmiDimension>): PmiItem {
  return item({
    id: "d1",
    kind: "dimension",
    dimension: {
      type: "linearDistance",
      value: 10,
      upper: null,
      lower: null,
      upperBound: null,
      lowerBound: null,
      fitClass: null,
      qualifier: null,
      decimals: null,
      modifiers: [],
      descriptions: [],
      ...overrides
    }
  });
}

function tolerance(overrides: Partial<PmiTolerance>): PmiItem {
  return item({
    id: "t1",
    kind: "tolerance",
    tolerance: {
      type: "position",
      value: 0.1,
      zoneShape: null,
      material: null,
      zoneModifier: null,
      zoneModifierValue: null,
      modifiers: [],
      maxValue: null,
      datums: [],
      ...overrides
    }
  });
}

function doc(overrides: Partial<PmiDocument> = {}): PmiDocument {
  return {
    version: 1,
    unit: "mm",
    sourceUnit: "mm",
    items: [],
    faces: [],
    edges: [],
    views: [],
    ...overrides
  };
}

const label = (
  pmi: PmiItem,
  unit: "mm" | "in" = "mm",
  sourceUnit: "mm" | "in" | null = "mm"
) => formatPmiItem(pmi, unit, sourceUnit).label;

describe("parsePmiDocument", () => {
  it("accepts a version 1 document and keeps extra fields", () => {
    const json = {
      ...doc({
        items: [
          dimension({ value: 5 }),
          item({ id: "a1", kind: "datum", datum: null })
        ],
        faces: [{ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }],
        edges: [[0, 0, 0, 1, 1, 1]],
        views: [
          {
            id: "v1",
            name: "Front",
            direction: [0, 1, 0],
            up: [0, 0, 1],
            projection: "parallel",
            itemIds: ["d1"]
          }
        ]
      }),
      future: "field"
    };
    const parsed = parsePmiDocument(JSON.parse(JSON.stringify(json)));
    expect(parsed?.items).toHaveLength(2);
    expect(parsed?.views[0]?.name).toBe("Front");
  });

  it("reads a missing source unit as null", () => {
    const { sourceUnit: _, ...rest } = doc();
    expect(parsePmiDocument(rest)?.sourceUnit).toBeNull();
  });

  it("refuses another version or a wrong shape", () => {
    expect(parsePmiDocument({ ...doc(), version: 2 })).toBeNull();
    expect(parsePmiDocument({ ...doc(), items: {} })).toBeNull();
    expect(parsePmiDocument({ ...doc(), views: [{ id: "v1" }] })).toBeNull();
    expect(
      parsePmiDocument({ ...doc(), items: [{ id: "x", kind: "weld" }] })
    ).toBeNull();
    expect(parsePmiDocument({ ...doc(), sourceUnit: "ft" })).toBeNull();
    expect(parsePmiDocument(null)).toBeNull();
    expect(parsePmiDocument("pmi")).toBeNull();
  });
});

describe("formatPmiItem — dimensions", () => {
  it("prints a symmetric tolerance as ±", () => {
    expect(label(dimension({ value: 10, upper: 0.1, lower: -0.1 }))).toBe(
      "10 ±0.1"
    );
  });

  it("prints an asymmetric tolerance as + / −", () => {
    expect(label(dimension({ value: 10, upper: 0.1, lower: -0.05 }))).toBe(
      "10 +0.1 / −0.05"
    );
    expect(label(dimension({ value: 10, upper: 0.2, lower: 0 }))).toBe(
      "10 +0.2 / 0"
    );
  });

  it("prints limits instead of a nominal", () => {
    expect(
      label(dimension({ value: 10, upperBound: 10.1, lowerBound: 9.9 }))
    ).toBe("10.1/9.9");
  });

  it("prints a hole fit class in upper case and a shaft in lower case", () => {
    expect(
      label(
        dimension({
          type: "diameter",
          value: 12,
          fitClass: { hole: true, formVariance: "h", grade: "IT7" }
        })
      )
    ).toBe("⌀12 H7");
    expect(
      label(
        dimension({
          type: "diameter",
          value: 12,
          fitClass: { hole: false, formVariance: "G", grade: "IT6" }
        })
      )
    ).toBe("⌀12 g6");
  });

  it("prefixes diameters and radii", () => {
    expect(label(dimension({ type: "diameter", value: 8 }))).toBe("⌀8");
    expect(label(dimension({ type: "sphericalDiameter", value: 8 }))).toBe(
      "S⌀8"
    );
    expect(label(dimension({ type: "radius", value: 4 }))).toBe("R4");
    expect(label(dimension({ type: "sphericalRadius", value: 4 }))).toBe("SR4");
    expect(formatPmiItem(dimension({ type: "diameter" }), "mm", null)).toEqual({
      label: "⌀10",
      symbol: null,
      title: "Diameter"
    });
  });

  it("suffixes a MIN or MAX qualifier", () => {
    expect(label(dimension({ value: 3, qualifier: "min" }))).toBe("3 MIN");
    expect(label(dimension({ value: 3, qualifier: "max" }))).toBe("3 MAX");
  });

  it("prints angles in degrees in either unit", () => {
    const angle = dimension({
      type: "angular",
      value: 45,
      upper: 0.5,
      lower: -0.5
    });
    expect(label(angle, "mm")).toBe("45° ±0.5°");
    expect(label(angle, "in")).toBe("45° ±0.5°");
    expect(formatPmiItem(angle, "in", "mm").title).toBe("Angle");
  });

  it("converts lengths to inches", () => {
    expect(
      label(dimension({ value: 25.4, upper: 0.127, lower: -0.127 }), "in", "mm")
    ).toBe("1 ±0.005");
  });

  it("uses the file's decimals only in the file's own unit", () => {
    const inchFile = dimension({
      value: 25.4,
      upper: 0.254,
      lower: -0.254,
      decimals: { left: 1, right: 3 }
    });
    expect(label(inchFile, "in", "in")).toBe("1.000 ±0.010");
    expect(label(inchFile, "mm", "in")).toBe("25.4 ±0.254");

    const mmFile = dimension({ value: 10, decimals: { left: 2, right: 2 } });
    expect(label(mmFile, "mm", "mm")).toBe("10.00");
    expect(label(mmFile, "in", "mm")).toBe("0.3937");
  });

  it("falls back to 3 decimals in mm and 4 in inches, trimmed", () => {
    expect(label(dimension({ value: 10.12345 }), "mm", null)).toBe("10.123");
    expect(label(dimension({ value: 10.5 }), "mm", null)).toBe("10.5");
    expect(label(dimension({ value: 10 }), "in", null)).toBe("0.3937");
  });

  it("names a graphic-only annotation", () => {
    const note = item({
      id: "d2",
      kind: "dimension",
      name: "Surface finish",
      dimension: {
        ...(dimension({}).dimension as PmiDimension),
        type: "presentation"
      }
    });
    expect(label(note)).toBe("Surface finish");
  });
});

describe("formatPmiItem — tolerances, datums and notes", () => {
  it("prints a feature control frame", () => {
    const result = formatPmiItem(
      tolerance({
        type: "position",
        value: 0.1,
        zoneShape: "diameter",
        material: "M",
        datums: [
          { name: "A", modifiers: [] },
          { name: "B", modifiers: ["maximumMaterialRequirement"] },
          { name: "C", modifiers: [] }
        ]
      }),
      "mm",
      "mm"
    );
    expect(result).toEqual({
      label: "⌖ | ⌀0.1 Ⓜ | A | B Ⓜ | C",
      symbol: "⌖",
      title: "Position"
    });
  });

  it("prints a flatness zone in inches with no datums", () => {
    const result = formatPmiItem(
      tolerance({ type: "flatness", value: 0.0254 }),
      "in",
      "mm"
    );
    expect(result.label).toBe("⏥ | 0.001");
    expect(result.title).toBe("Flatness");
  });

  it("marks a projected zone", () => {
    expect(
      label(tolerance({ type: "perpendicularity", zoneModifier: "projected" }))
    ).toBe("⟂ | 0.1 Ⓟ");
  });

  it("prints a datum as its letter", () => {
    expect(
      formatPmiItem(
        item({
          id: "a1",
          kind: "datum",
          datum: { name: "B", modifiers: [], target: null }
        }),
        "mm",
        null
      )
    ).toEqual({ label: "B", symbol: null, title: "Datum B" });
  });

  it("prints a note by its name", () => {
    expect(label(item({ id: "n1", kind: "note", name: "NOTE 1" }))).toBe(
      "NOTE 1"
    );
    expect(label(item({ id: "n2", kind: "note" }))).toBe("Note 2");
  });

  it("numbers a note whose name is a CAD exporter's generic one", () => {
    expect(label(item({ id: "n7", kind: "note", name: "DGT:Dimension" }))).toBe(
      "Note 7"
    );
  });
});

describe("groupPmiItems", () => {
  it("groups in panel order and skips empty groups", () => {
    const groups = groupPmiItems(
      doc({
        items: [
          item({ id: "n1", kind: "note" }),
          tolerance({}),
          dimension({}),
          item({ id: "n2", kind: "note" })
        ]
      })
    );
    expect(groups.map((g) => g.title)).toEqual([
      "Dimensions",
      "Tolerances",
      "Notes"
    ]);
    expect(groups[2]?.items.map((i) => i.id)).toEqual(["n1", "n2"]);
  });
});

describe("visibleItemIds", () => {
  const pmi = doc({
    items: [dimension({}), tolerance({}), item({ id: "a1", kind: "datum" })],
    views: [
      {
        id: "v1",
        name: "Front",
        direction: [0, 1, 0],
        up: [0, 0, 1],
        projection: null,
        itemIds: ["t1", "a1"]
      },
      {
        id: "v2",
        name: "Camera only",
        direction: [1, 0, 0],
        up: [0, 0, 1],
        projection: null,
        itemIds: []
      }
    ]
  });

  it("shows every item for no view, an unknown view or an empty view", () => {
    expect([...visibleItemIds(pmi, null)]).toEqual(["d1", "t1", "a1"]);
    expect([...visibleItemIds(pmi, "nope")]).toEqual(["d1", "t1", "a1"]);
    expect([...visibleItemIds(pmi, "v2")]).toEqual(["d1", "t1", "a1"]);
  });

  it("shows only the view's items", () => {
    expect([...visibleItemIds(pmi, "v1")]).toEqual(["t1", "a1"]);
  });
});

describe("bounds", () => {
  const withGeometry = doc({
    items: [
      item({
        id: "d1",
        kind: "dimension",
        lines: [[0, 0, 0, 10, 0, 0]],
        textPosition: [5, 2, 0],
        faces: [0],
        edges: [0]
      }),
      item({
        id: "t1",
        kind: "tolerance",
        mesh: { positions: [20, 20, 20, 21, 21, 21, 20, 21, 20], indices: [] }
      })
    ],
    faces: [{ positions: [0, 0, -5, 1, 1, -5, 0, 1, -5], indices: [0, 1, 2] }],
    edges: [[0, -3, 0, 0, 3, 0]],
    views: [
      {
        id: "v1",
        name: "Top",
        direction: [0, 0, -1],
        up: [0, 1, 0],
        projection: null,
        itemIds: ["t1"]
      }
    ]
  });
  const [d1, t1] = withGeometry.items as [PmiItem, PmiItem];

  it("spans an item's lines and text anchor", () => {
    expect(pmiItemBounds(withGeometry, d1, false)).toEqual({
      min: [0, 0, 0],
      max: [10, 2, 0]
    });
  });

  it("adds the referenced faces and edges on request", () => {
    expect(pmiItemBounds(withGeometry, d1, true)).toEqual({
      min: [0, -3, -5],
      max: [10, 3, 0]
    });
  });

  it("spans a mesh, and is null with no geometry", () => {
    expect(pmiItemBounds(withGeometry, t1, false)).toEqual({
      min: [20, 20, 20],
      max: [21, 21, 21]
    });
    expect(
      pmiItemBounds(withGeometry, item({ id: "x", kind: "note" }), true)
    ).toBeNull();
  });

  it("spans a view's items, or every item with no view", () => {
    expect(pmiViewBounds(withGeometry, "v1")).toEqual({
      min: [20, 20, 20],
      max: [21, 21, 21]
    });
    expect(pmiViewBounds(withGeometry, null)).toEqual({
      min: [0, -3, -5],
      max: [21, 21, 21]
    });
  });
});

describe("pmiInspectionCharacteristics", () => {
  const characteristics = (items: PmiItem[], sourceUnit: "mm" | "in" = "mm") =>
    pmiInspectionCharacteristics(doc({ items, sourceUnit }));

  it("takes a ± dimension's nominal and deviations", () => {
    const [row] = characteristics([
      dimension({ type: "diameter", value: 10, upper: 0.05, lower: -0.02 })
    ]);
    expect(row).toMatchObject({
      pmiItemId: "d1",
      label: "1",
      nominalValue: "10",
      tolerancePlus: "0.05",
      toleranceMinus: "0.02",
      unit: "mm"
    });
    expect(row?.description).toContain("Diameter");
    expect(row?.description).toContain("⌀10");
  });

  it("re-centres a deviation that lies wholly below the nominal", () => {
    const [row] = characteristics([
      dimension({ type: "diameter", value: 10, upper: -0.013, lower: -0.028 })
    ]);
    // The band is 9.972–9.987: centre 9.9795, half width 0.0075.
    expect(row).toMatchObject({
      nominalValue: "9.9795",
      tolerancePlus: "0.0075",
      toleranceMinus: "0.0075"
    });
  });

  it("re-centres a deviation that lies wholly above the nominal", () => {
    const [row] = characteristics([
      dimension({ value: 10, upper: 0.05, lower: 0.02 })
    ]);
    expect(row).toMatchObject({
      nominalValue: "10.035",
      tolerancePlus: "0.015",
      toleranceMinus: "0.015"
    });
  });

  it("centres a limit dimension between its limits", () => {
    const [row] = characteristics([
      dimension({ value: 10.05, upperBound: 10.1, lowerBound: 10 })
    ]);
    expect(row).toMatchObject({
      nominalValue: "10.05",
      tolerancePlus: "0.05",
      toleranceMinus: "0.05"
    });
  });

  it("records a dimension with no numeric limits as Pass or Fail", () => {
    const [row] = characteristics([
      dimension({
        type: "diameter",
        value: 8,
        fitClass: { hole: true, formVariance: "H", grade: "IT7" }
      })
    ]);
    expect(row).toMatchObject({
      nominalValue: null,
      tolerancePlus: null,
      toleranceMinus: null
    });
  });

  it("leaves out labels, dimensions with no value, datums and notes", () => {
    const rows = characteristics([
      dimension({ type: "presentation" }),
      dimension({ value: null, upper: 0.1, lower: -0.1 }),
      item({
        id: "a1",
        kind: "datum",
        datum: { name: "A", modifiers: [], target: null }
      }),
      item({ id: "n1", kind: "note" })
    ]);
    expect(rows).toEqual([]);
  });

  it("keeps an angle in degrees in an inch model", () => {
    const [row] = characteristics(
      [dimension({ type: "angular", value: 45, upper: 0.5, lower: -0.5 })],
      "in"
    );
    expect(row).toMatchObject({
      nominalValue: "45",
      tolerancePlus: "0.5",
      unit: "deg"
    });
  });

  it("converts lengths to inches for an inch model", () => {
    const [row] = characteristics(
      [dimension({ value: 25.4, upper: 0.127, lower: -0.127 })],
      "in"
    );
    expect(row).toMatchObject({
      nominalValue: "1",
      tolerancePlus: "0.005",
      toleranceMinus: "0.005",
      unit: "in"
    });
  });

  it("measures a geometric tolerance as a deviation within its zone", () => {
    const [row] = characteristics([
      tolerance({ type: "flatness", value: 0.02 })
    ]);
    expect(row).toMatchObject({
      pmiItemId: "t1",
      nominalValue: "0",
      tolerancePlus: "0.02",
      toleranceMinus: "0",
      unit: "mm"
    });
    expect(row?.description).toBe("Flatness ⏥ | 0.02");
  });

  it("records a geometric tolerance with no zone as Pass or Fail", () => {
    const [row] = characteristics([tolerance({ value: null })]);
    expect(row?.nominalValue).toBeNull();
  });

  it("numbers characteristics in file order, skipping what it leaves out", () => {
    const rows = characteristics([
      { ...dimension({ value: 5, upper: 0.1, lower: -0.1 }), id: "d1" },
      item({
        id: "a1",
        kind: "datum",
        datum: { name: "A", modifiers: [], target: null }
      }),
      { ...tolerance({ value: 0.1 }), id: "t1" },
      { ...dimension({ value: 7, upper: 0.1, lower: -0.1 }), id: "d2" }
    ]);
    expect(rows.map((r) => [r.label, r.pmiItemId])).toEqual([
      ["1", "d1"],
      ["2", "t1"],
      ["3", "d2"]
    ]);
  });
});
